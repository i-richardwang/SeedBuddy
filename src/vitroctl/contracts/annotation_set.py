"""Image identity and class consistency across an annotation set."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol


class ClassifiedInstance(Protocol):
    @property
    def class_name(self) -> str: ...


class ImageAnnotations(Protocol):
    @property
    def digest(self) -> str: ...

    @property
    def width(self) -> int: ...

    @property
    def height(self) -> int: ...

    @property
    def instances(self) -> Sequence[ClassifiedInstance]: ...


@dataclass(frozen=True)
class AnnotatedImage:
    digest: str
    width: int
    height: int
    documents: Mapping[str, ImageAnnotations | None]


def validate_annotation_set(
    images: Iterable[AnnotatedImage],
    classes: Iterable[str] | None,
    context: str,
) -> None:
    known = None if classes is None else set(classes)
    digests: set[str] = set()
    for index, image in enumerate(images):
        if image.digest in digests:
            raise ValueError(f"{context} lists an image digest more than once")
        digests.add(image.digest)
        for field, document in image.documents.items():
            if document is None:
                continue
            location = f"{context}.images[{index}].{field}"
            if document.digest != image.digest:
                raise ValueError(f"{location} describes another image")
            if (document.width, document.height) != (image.width, image.height):
                raise ValueError(f"{location} dimensions differ from the image")
            if known is not None:
                unknown = sorted(
                    {instance.class_name for instance in document.instances} - known
                )
                if unknown:
                    raise ValueError(
                        f"{location} uses unknown class"
                        f"{'es' if len(unknown) > 1 else ''}: {', '.join(unknown)}"
                    )
