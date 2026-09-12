"""Tiny in-process store tying the redo -> select -> export flow together.

Not a database - just enough state for a single-session hackathon demo. Maps
segment ids to their pending candidate clips, and remembers the latest spliced
/ exported result per video for the export endpoint.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

_seg_counter = itertools.count(1)


@dataclass
class SegmentRecord:
    segment_id: str
    video_id: str
    t_start: float
    t_end: float
    positive_prompt: str
    negative_prompt: str
    # candidate_id -> generated clip path
    candidates: Dict[str, Path] = field(default_factory=dict)
    candidate_source: str = "local_fallback"


class Store:
    def __init__(self) -> None:
        self._segments: Dict[str, SegmentRecord] = {}
        self._spliced: Dict[str, Path] = {}   # video_id -> latest spliced full video
        self._exported: Dict[str, Path] = {}  # video_id -> exported file

    def new_segment_id(self) -> str:
        return f"seg_{next(_seg_counter)}"

    def put_segment(self, rec: SegmentRecord) -> None:
        self._segments[rec.segment_id] = rec

    def get_segment(self, segment_id: str) -> Optional[SegmentRecord]:
        return self._segments.get(segment_id)

    def set_spliced(self, video_id: str, path: Path) -> None:
        self._spliced[video_id] = path

    def get_spliced(self, video_id: str) -> Optional[Path]:
        return self._spliced.get(video_id)

    def set_exported(self, video_id: str, path: Path) -> None:
        self._exported[video_id] = path

    def get_exported(self, video_id: str) -> Optional[Path]:
        return self._exported.get(video_id)


store = Store()
