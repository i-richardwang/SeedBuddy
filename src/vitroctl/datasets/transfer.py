"""Move one workbench dataset between a workbench and a local data root.

A data root stores image bytes as content-addressed blobs shared by every
dataset and one manifest per dataset. ``pull_dataset`` fetches the dataset's
manifest, keeps every local blob that verifies against its digest, downloads
the rest, and then installs the manifest with a single atomic rename.
``push_dataset`` sends the blobs a local manifest names and then the manifest,
which the workbench applies as one step; the dataset exists there afterwards
or not at all.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from vitroctl.contracts.identifiers import DATASET_NAME
from vitroctl.datasets.manifest import (
    MAX_DATASET_MANIFEST_BYTES,
    BlobError,
    DatasetManifest,
    ManifestImage,
    blob_path,
    encode_dataset_manifest,
    load_dataset_manifest,
    manifest_path,
    parse_dataset_manifest,
    verified_blob,
)
from vitroctl.io.files import atomic_file
from vitroctl.io.image_io import MAX_IMAGE_BYTES

TRANSFER_TIMEOUT = httpx.Timeout(120.0, read=None, write=None)


class DatasetTransferError(RuntimeError):
    pass


@dataclass(frozen=True)
class PullReport:
    """How each image of the pulled dataset reached the data root."""

    dataset: str
    kept: int
    downloaded: int
    replaced: int

    @property
    def images(self) -> int:
        return self.kept + self.downloaded + self.replaced


@dataclass(frozen=True)
class PushReport:
    """What the workbench received for the pushed dataset."""

    dataset: str
    images: int


def _client(
    server_url: str, token: str, transport: httpx.BaseTransport | None
) -> httpx.Client:
    return httpx.Client(
        base_url=server_url.rstrip("/") + "/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=TRANSFER_TIMEOUT,
        transport=transport,
    )


def _dataset_url(dataset: str) -> str:
    if not DATASET_NAME.fullmatch(dataset):
        raise DatasetTransferError(f"Invalid dataset name: {dataset}")
    return f"api/transfer/datasets/{dataset}"


def _image_url(digest: str) -> str:
    return f"api/transfer/images/{digest}"


def _bounded_get(client: httpx.Client, url: str, limit: int, excessive: str) -> bytes:
    with client.stream("GET", url) as response:
        response.raise_for_status()
        declared = response.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            raise DatasetTransferError(excessive)
        contents = bytearray()
        for chunk in response.iter_bytes():
            if len(contents) + len(chunk) > limit:
                raise DatasetTransferError(excessive)
            contents.extend(chunk)
    return bytes(contents)


def _download_blob(client: httpx.Client, digest: str, target: Path) -> None:
    content = _bounded_get(
        client,
        _image_url(digest),
        MAX_IMAGE_BYTES,
        f"Image exceeds {MAX_IMAGE_BYTES} bytes: {digest}",
    )
    if hashlib.sha256(content).hexdigest() != digest:
        raise DatasetTransferError(
            f"Content failed digest verification against {digest}"
        )
    try:
        with atomic_file(target) as handle:
            handle.write(content)
    finally:
        if not target.exists():
            try:
                target.parent.rmdir()
            except OSError:
                pass


def _manifest_blob(data_root: Path, image: ManifestImage) -> Path:
    path = blob_path(data_root, image.digest)
    try:
        size = path.stat().st_size
    except FileNotFoundError as error:
        raise BlobError(
            f"Blob is missing from the data root: {image.digest}"
        ) from error
    if size != image.bytes:
        raise DatasetTransferError(
            f"Blob size differs from the manifest: {image.digest}"
        )
    return verified_blob(data_root, image.digest)


def _fetch_manifest(client: httpx.Client, dataset: str) -> DatasetManifest:
    contents = _bounded_get(
        client,
        _dataset_url(dataset),
        MAX_DATASET_MANIFEST_BYTES,
        f"Manifest exceeds {MAX_DATASET_MANIFEST_BYTES} bytes",
    )
    try:
        manifest = parse_dataset_manifest(json.loads(contents), "manifest")
    except (TypeError, ValueError) as error:
        raise DatasetTransferError(str(error)) from error
    if manifest.dataset != dataset:
        raise DatasetTransferError(
            f"Manifest describes another dataset: {manifest.dataset}"
        )
    return manifest


def pull_dataset(
    server_url: str,
    token: str,
    dataset: str,
    output: str | Path,
    *,
    transport: httpx.BaseTransport | None = None,
) -> PullReport:
    """Mirror one dataset into ``output`` and report what the pull did.

    A local blob is kept only when its bytes verify against its digest; a
    missing or failing blob is downloaded and verified, replacing any file that
    was there. The manifest is installed once every blob is in place.
    """
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    kept = downloaded = replaced = 0
    with _client(server_url, token, transport) as client:
        manifest = _fetch_manifest(client, dataset)
        for image in manifest.images:
            target = blob_path(root, image.digest)
            try:
                _manifest_blob(root, image)
            except BlobError:
                present = target.is_file()
                _download_blob(client, image.digest, target)
                try:
                    _manifest_blob(root, image)
                except (BlobError, DatasetTransferError) as error:
                    target.unlink(missing_ok=True)
                    raise DatasetTransferError(str(error)) from error
                if present:
                    replaced += 1
                else:
                    downloaded += 1
            else:
                kept += 1
    with atomic_file(manifest_path(root, dataset)) as handle:
        handle.write(encode_dataset_manifest(manifest))
    return PullReport(dataset, kept, downloaded, replaced)


def _refused(response: httpx.Response) -> DatasetTransferError:
    try:
        message = response.json()["error"]
    except (ValueError, KeyError, TypeError):
        message = response.text
    return DatasetTransferError(f"Workbench refused the dataset: {message}")


def push_dataset(
    server_url: str,
    token: str,
    dataset: str,
    data_root: str | Path,
    *,
    transport: httpx.BaseTransport | None = None,
) -> PushReport:
    """Send one dataset of ``data_root`` to a workbench that does not have it.

    Every blob the manifest names must verify locally before anything is sent.
    The workbench acknowledges each blob, then applies the manifest as one
    step; a manifest it refuses leaves it without the dataset.
    """
    root = Path(data_root)
    source = manifest_path(root, dataset)
    try:
        if source.stat().st_size > MAX_DATASET_MANIFEST_BYTES:
            raise DatasetTransferError(
                f"Manifest exceeds {MAX_DATASET_MANIFEST_BYTES} bytes"
            )
        manifest = load_dataset_manifest(source)
        manifest_bytes = encode_dataset_manifest(manifest)
    except FileNotFoundError as error:
        raise DatasetTransferError(f"No manifest for {dataset} in {root}") from error
    except (TypeError, ValueError) as error:
        raise DatasetTransferError(str(error)) from error
    if manifest.dataset != dataset:
        raise DatasetTransferError(
            f"Manifest describes another dataset: {manifest.dataset}"
        )
    blobs = []
    for image in manifest.images:
        try:
            blobs.append(_manifest_blob(root, image))
        except BlobError as error:
            raise DatasetTransferError(str(error)) from error
    with _client(server_url, token, transport) as client:
        existing = client.get(_dataset_url(dataset))
        if existing.status_code == 200:
            raise DatasetTransferError(f"Dataset {dataset} already exists there")
        if existing.status_code != 404:
            existing.raise_for_status()
        for image, path in zip(manifest.images, blobs, strict=True):
            response = client.put(
                _image_url(image.digest),
                content=path.read_bytes(),
                headers={"Content-Type": "image/avif"},
            )
            if response.status_code == 400:
                raise _refused(response)
            response.raise_for_status()
        response = client.put(
            _dataset_url(dataset),
            content=manifest_bytes,
            headers={"Content-Type": "application/json"},
        )
        if response.status_code in (400, 409):
            raise _refused(response)
        response.raise_for_status()
    return PushReport(dataset, len(manifest.images))
