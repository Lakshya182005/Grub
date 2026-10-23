"""tools/lifecycle.py — Structured lifecycle audit logger."""

import json
import os
import time
import uuid


class Audit:
    """Writes timestamped structured events for session auditing."""

    def __init__(self, name: str = "sidecar", root: str | None = None, session_id: str | None = None):
        self.name = name
        self.root = os.path.abspath(root or os.path.join(os.path.dirname(__file__), ".."))
        self.audit_dir = os.path.join(self.root, ".audit")
        os.makedirs(self.audit_dir, exist_ok=True)
        self.log_path = os.path.join(self.audit_dir, "audit.jsonl")
        self.session_id = session_id or uuid.uuid4().hex[:8]
        self.t0 = time.time()

    def event(self, name: str, **kwargs) -> dict:
        now = time.time()
        record = {
            "session_id": self.session_id,
            "source": self.name,
            "name": name,
            "rel_s": round(now - self.t0, 4),
            "wall_time": now,
            **kwargs,
        }
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
        except Exception:
            pass
        return record
