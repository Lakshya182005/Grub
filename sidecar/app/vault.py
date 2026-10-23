"""app/vault.py — Atomic markdown note writer with snapshot history."""

from datetime import datetime
import logging
import os
import re
import shutil
import uuid

logger = logging.getLogger("sidecar.vault")

DEFAULT_ROOT = os.path.expanduser("~/Documents/Hey Scribe")


class Vault:
    """Manages note creation in ~/Documents/Hey Scribe with atomic writes and snapshots."""

    def __init__(self, root: str = DEFAULT_ROOT):
        self.root = os.path.realpath(os.path.abspath(os.path.expanduser(root)))
        os.makedirs(self.root, exist_ok=True)
        self.snapshots_dir = os.path.join(self.root, ".snapshots")

    def _sanitize_title(self, title: str) -> str:
        # Keep letters, numbers, spaces, and hyphens; limit to 60 characters
        sanitized = re.sub(r"[^A-Za-z0-9 -]", "", title).strip()
        sanitized = re.sub(r"\s+", " ", sanitized)
        if not sanitized:
            sanitized = "Untitled Note"
        return sanitized[:60].strip()

    def create(self, title: str, body: str) -> dict:
        """Create a Markdown note file atomically. Returns {"id": str, "path": str, "title": str, "body": str}."""
        clean_title = title.strip() or "Untitled Note"
        sanitized_filename_title = self._sanitize_title(clean_title)

        now = datetime.now()
        timestamp_prefix = now.strftime("%Y-%m-%d %H%M")
        filename = f"{timestamp_prefix} - {sanitized_filename_title}.md"
        target_path = os.path.realpath(os.path.join(self.root, filename))

        # Security check: Ensure file path is strictly within vault root
        if not target_path.startswith(self.root + os.sep) and target_path != self.root:
            raise ValueError(f"Path traversal detected: {target_path} is outside {self.root}")

        # Snapshot before overwrite if target file already exists
        if os.path.exists(target_path):
            os.makedirs(self.snapshots_dir, exist_ok=True)
            snap_time = now.strftime("%Y%m%d-%H%M%S")
            snap_name = f"{snap_time}_{filename}"
            snap_path = os.path.join(self.snapshots_dir, snap_name)
            try:
                shutil.copy2(target_path, snap_path)
                logger.info("Created snapshot before overwrite: %s", snap_path)
            except Exception as e:
                logger.warning("Failed to create snapshot for %s: %s", target_path, e)

        # Build Markdown content with front matter
        created_iso = now.isoformat()
        md_content = (
            "---\n"
            f"created: {created_iso}\n"
            "source: hey-scribe-voice\n"
            "---\n\n"
            f"# {clean_title}\n\n"
            f"{body.strip()}\n"
        )

        note_id = str(uuid.uuid4())
        temp_path = os.path.join(self.root, f".tmp_{note_id}.md")

        # Atomic write: write to temp file, then os.replace
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(md_content)
            f.flush()
            os.fsync(f.fileno())

        os.replace(temp_path, target_path)
        logger.info("Note created successfully at %s (%d bytes)", target_path, len(md_content))

        return {
            "id": note_id,
            "path": target_path,
            "title": clean_title,
            "body": body.strip(),
        }
