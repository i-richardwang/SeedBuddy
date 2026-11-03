import json
from pathlib import Path

import pytest
from conftest import annotation_document, manifest_entry, write_manifest

from vitroctl.contracts.annotation import AnnotationDocument
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.datasets.annotations import load_annotations

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "annotation.json"


def test_load_annotations_keeps_only_annotated_images(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    manifest = write_manifest(
        data_root,
        "batch",
        [
            manifest_entry("1" * 64, annotation=annotation_document("1" * 64)),
            manifest_entry("2" * 64),
        ],
    )

    annotated = load_annotations(manifest)

    assert [image.digest for image in annotated] == ["1" * 64]
    annotation = annotated[0].annotation
    assert annotation is not None
    assert (annotated[0].width, annotated[0].height) == (100, 80)
    assert annotation.digest == "1" * 64
    assert annotation.instances[0].bbox.center == (14.0, 23.0)


def test_shared_annotation_contract() -> None:
    payload = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    annotation = AnnotationDocument.from_document(payload, "annotation")

    assert annotation.digest == "c" * 64
    assert len(annotation.instances) == 1


def test_annotation_must_describe_its_manifest_image(tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path,
        "batch",
        [manifest_entry("1" * 64, annotation=annotation_document("2" * 64))],
    )
    with pytest.raises(ValueError, match="describes another image"):
        load_annotations(manifest)


def test_annotation_classes_belong_to_the_manifest_model(tmp_path: Path) -> None:
    annotation = annotation_document("1" * 64)
    annotation["instances"][0]["class"] = "germinated"
    manifest = write_manifest(
        tmp_path,
        "batch",
        [manifest_entry("1" * 64, annotation=annotation)],
        classes=["seed"],
    )

    with pytest.raises(ValueError, match="unknown class: germinated"):
        load_annotations(manifest)


def test_manifest_rejects_images_without_pixel_dimensions(tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path, "batch", [manifest_entry("1" * 64, width=0)])
    with pytest.raises(ValueError, match=r"images\[0\].width.*shared contract"):
        load_annotations(manifest)


def test_unversioned_annotation_is_rejected() -> None:
    payload = annotation_document("1" * 64)
    del payload["schemaVersion"]

    with pytest.raises(ValueError, match="annotation.*shared contract"):
        AnnotationDocument.from_document(payload)


def test_annotation_schema_rejects_unknown_fields_and_invalid_identities() -> None:
    payload = annotation_document("1" * 64)
    payload["unexpected"] = True
    with pytest.raises(ValueError, match="annotation.*shared contract"):
        AnnotationDocument.from_document(payload)
    with pytest.raises(ValueError, match="annotation.image.digest.*shared contract"):
        validate_wire_contract(
            "annotation", annotation_document("images/a.jpg"), "annotation"
        )

    payload = annotation_document(
        "1" * 64, [{"x": 95, "y": 20, "width": 8, "height": 6}]
    )
    with pytest.raises(ValueError, match=r"instances\[0\].bbox exceeds image bounds"):
        AnnotationDocument.from_document(payload, "annotation")
