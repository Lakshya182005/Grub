#!/usr/bin/env python3
"""tools/audit_report.py — Format lifecycle audit timeline or session list."""

import argparse
import collections
import json
import os
import sys

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUDIT_FILE = os.path.join(ROOT_DIR, ".audit", "audit.jsonl")


def load_events() -> list[dict]:
    if not os.path.exists(AUDIT_FILE):
        return []
    events = []
    with open(AUDIT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events


def format_timeline(events: list[dict]) -> None:
    if not events:
        print("No audit events recorded yet.")
        return

    # Check for gaps > 2.0s between events
    prev_wall = None
    for ev in events:
        rel = ev.get("rel_s", 0.0)
        name = ev.get("name", "")
        wall = ev.get("wall_time", 0.0)
        gap_str = ""
        if prev_wall is not None and wall - prev_wall > 2.0:
            gap_str = f"    ← {wall - prev_wall:.1f}s gap"
        prev_wall = wall

        is_ok = ".ok" in name or name in ("wake", "utterance.end")
        mark = "✓" if is_ok else " "
        ms_str = f"{ev['ms']:.0f}ms" if "ms" in ev else ""

        # Format details
        extra = []
        for k, v in ev.items():
            if k not in ("session_id", "source", "name", "rel_s", "wall_time", "ms"):
                val_str = str(v)
                if len(val_str) > 60:
                    val_str = val_str[:57] + "..."
                extra.append(f"{k}={val_str}")
        extra_str = "  ".join(extra)

        print(f"{rel:6.3f}s {mark} {name:<24} {ms_str:<8} {extra_str}{gap_str}")


def format_all_sessions(events: list[dict]) -> None:
    if not events:
        print("No audit sessions found.")
        return

    sessions = collections.defaultdict(list)
    for ev in events:
        sessions[ev.get("session_id", "unknown")].append(ev)

    print(f"Found {len(sessions)} session(s):")
    print(f"{'SESSION':<10} {'EVENTS':<8} {'BOOT':<6} {'CLEAN':<6} {'FAILURES':<10} {'DURATION':<10}")
    print("-" * 55)

    for sid, evs in sessions.items():
        has_boot = any(e.get("name") == "boot" for e in evs)
        has_shutdown = any(e.get("name") == "shutdown" for e in evs)
        failures = [e.get("name") for e in evs if ".fail" in e.get("name", "")]
        duration = evs[-1].get("rel_s", 0.0) - evs[0].get("rel_s", 0.0)

        boot_str = "YES" if has_boot else "NO"
        clean_str = "YES" if has_shutdown else "NO"
        fail_str = str(len(failures)) if failures else "0"

        print(f"{sid:<10} {len(evs):<8} {boot_str:<6} {clean_str:<6} {fail_str:<10} {duration:<8.2f}s")


def main():
    parser = argparse.ArgumentParser(description="Lifecycle audit reporter")
    parser.add_argument("--all", action="store_true", help="Show summary of all sessions")
    args = parser.parse_args()

    events = load_events()
    if args.all:
        format_all_sessions(events)
    else:
        # Show last session by default
        if events:
            last_sid = events[-1].get("session_id")
            session_events = [e for e in events if e.get("session_id") == last_sid]
            print(f"=== Session {last_sid} ===")
            format_timeline(session_events)
        else:
            print("No audit events recorded yet.")


if __name__ == "__main__":
    main()
