"""Serve the page on which a person confirms a record of sorted photographs.

The page shows each dish with every photograph taken of it. The person takes
the suggested photograph or another, and says whether its seeds can be counted.
"""

from __future__ import annotations

import json
import mimetypes
import threading
from functools import cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2

from seedbuddy.photos.record import (
    accept_remaining,
    clear_confirmation,
    confirm,
    is_verdict,
    load_record,
    save_record,
)

ROOT = Path(__file__).parent
PAGES = {
    "/": ("review_page.html", "text/html; charset=utf-8"),
    "/review.css": ("review.css", "text/css; charset=utf-8"),
    "/review.js": ("review.js", "text/javascript; charset=utf-8"),
}
THUMB_EDGE = 180
# A photograph within this log ratio of the sharpest renders the seeds about as
# well.
COMPARABLE = 0.1
MEDIA_CACHE = "private, max-age=86400"


def bind_review(path: Path) -> ReviewServer:
    return ReviewServer(load_record(path), path)


def serve_review(path: Path) -> None:
    server = bind_review(path)
    count = len(server.record["dishes"])
    print(f"Review {count} dishes at {server.origin}", flush=True)
    print(f"Confirmations are written to {path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(flush=True)
    finally:
        server.server_close()


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, record: dict, path: Path) -> None:
        self.record = record
        self.record_path = path
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", 0), ReviewHandler)
        host, port = self.server_address[:2]
        self.netloc = f"{host}:{port}"
        self.origin = f"http://{self.netloc}"


class ReviewHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: ReviewServer

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        if str(code).startswith("2"):
            return
        super().log_request(code, size)

    def parse_request(self) -> bool:
        """Admit only requests made by the page this server serves.

        A page on another site reaches this port under its own Origin, or
        under a Host name it has pointed at this machine.
        """
        if not super().parse_request():
            return False
        host, origin = self.headers.get("Host"), self.headers.get("Origin")
        if host != self.server.netloc or origin not in (None, self.server.origin):
            self.send_error(403)
            return False
        return True

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        page = PAGES.get(path)
        if page:
            name, content_type = page
            self._send((ROOT / name).read_bytes(), content_type)
            return
        if path == "/api/review":
            body = json.dumps(_view(self.server.record), ensure_ascii=False).encode()
            self._send(body, "application/json; charset=utf-8")
            return
        kind, _, place = path.removeprefix("/").partition("/")
        shot = _shot_at(self.server.record, place)
        if kind not in ("photo", "thumb") or shot is None:
            self.send_error(404)
            return
        file_path = Path(shot["path"])
        if not file_path.is_file():
            self.send_error(404)
            return
        if kind == "photo":
            content_type = mimetypes.types_map[file_path.suffix.lower()]
            self._send(file_path.read_bytes(), content_type, cache=MEDIA_CACHE)
            return
        thumbnail = _thumbnail(file_path)
        if thumbnail is None:
            self.send_error(404)
            return
        self._send(thumbnail, "image/jpeg", cache=MEDIA_CACHE)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._payload()
        if payload is None:
            self.send_error(400)
            return
        with self.server.lock:
            record = self.server.record
            if path == "/api/accept-remaining":
                accept_remaining(record)
            elif path.startswith("/api/dishes/"):
                dish = _index(path.removeprefix("/api/dishes/"))
                if dish is None or dish >= len(record["dishes"]):
                    self.send_error(404)
                    return
                if not _apply(record, dish, payload):
                    self.send_error(400)
                    return
            else:
                self.send_error(404)
                return
            save_record(self.server.record_path, record)
            body = json.dumps(_view(record), ensure_ascii=False).encode()
        self._send(body, "application/json; charset=utf-8")

    def _payload(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _send(self, body: bytes, content_type: str, cache: str = "no-store") -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)


def _apply(record: dict, dish: int, payload: dict) -> bool:
    if payload.get("clear") is True:
        clear_confirmation(record, dish)
        return True
    shot, note = payload.get("shot"), payload.get("note", "")
    if type(shot) is not int or not 0 <= shot < len(record["dishes"][dish]["shots"]):
        return False
    if "suitable" not in payload or not is_verdict(payload["suitable"]):
        return False
    if not isinstance(note, str):
        return False
    confirm(record, dish, shot, payload["suitable"], note.strip())
    return True


def _index(text: str) -> int | None:
    return int(text) if text.isdigit() else None


def _shot_at(record: dict, place: str) -> dict | None:
    """The shot at ``dish/shot``, both counted from zero."""
    dish, _, shot = place.partition("/")
    dish_index, shot_index = _index(dish), _index(shot)
    if dish_index is None or shot_index is None:
        return None
    dishes = record["dishes"]
    if dish_index >= len(dishes) or shot_index >= len(dishes[dish_index]["shots"]):
        return None
    return dishes[dish_index]["shots"][shot_index]


def _view(record: dict) -> dict:
    """What the page shows: the record with file names in place of paths."""
    return {
        "dishes": [
            {
                "index": index,
                "shots": [
                    {
                        "name": Path(shot["path"]).name,
                        "sharpness": shot["sharpness"],
                        "suitable": shot["suitable"],
                        "reason": shot["reason"],
                        "alignment": shot["alignment"],
                    }
                    for shot in dish["shots"]
                ],
                "doubtful": _doubtful(dish["shots"]),
                "decision": _decision(dish),
            }
            for index, dish in enumerate(record["dishes"])
        ],
        "skipped": len(record["skipped"]),
    }


def _doubtful(shots: list[dict]) -> bool:
    """Whether the suggestion is one a person would want to look at.

    Either the suggested photograph cannot be counted, or another photograph of
    the dish renders the seeds about as well or was never compared.
    """
    suggested, *others = shots
    return not suggested["suitable"] or any(
        other["sharpness"] is None or other["sharpness"] >= -COMPARABLE
        for other in others
    )


def _decision(dish: dict) -> dict | None:
    decision = dish.get("decision")
    if decision is None:
        return None
    paths = [shot["path"] for shot in dish["shots"]]
    return {
        "shot": paths.index(decision["chosen"]),
        "suitable": decision["suitable"],
        "note": decision["note"],
    }


@cache
def _thumbnail(source: Path) -> bytes | None:
    image = cv2.imread(str(source), cv2.IMREAD_REDUCED_COLOR_8)
    if image is None:
        return None
    height, width = image.shape[:2]
    scale = THUMB_EDGE / max(height, width)
    if scale < 1:
        image = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return cv2.imencode(".jpg", image)[1].tobytes()
