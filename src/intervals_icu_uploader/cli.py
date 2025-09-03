from __future__ import annotations
import argparse
import json
import os
import sys
from typing import Any

from .api import load_events_from_file, post_bulk_events, INTERVALS_DEFAULT_BASE


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload planned workouts to Intervals.icu")
    parser.add_argument("payload", help="Path to JSON payload file")
    parser.add_argument("--api-key", help="Intervals personal API key. If omitted, uses INTERVALS_API_KEY")
    parser.add_argument("--athlete-id", type=int, default=0, help="Defaults to 0 (self)")
    parser.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE, help="Defaults to https://intervals.icu")
    parser.add_argument("--no-upsert", action="store_true", help="Set to disable upsert=true behavior")
    parser.add_argument("--dry-run", action="store_true", help="Print payload and exit")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    args = parser.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: Provide --api-key or set INTERVALS_API_KEY", file=sys.stderr)
        return 2

    try:
        events = load_events_from_file(args.payload)
    except Exception as e:
        print(f"ERROR: Failed to read payload: {e}", file=sys.stderr)
        return 2

    if args.verbose or args.dry_run:
        print(f"Loaded {len(events)} event(s) from {args.payload}")
        if args.verbose:
            print(json.dumps(events, indent=2))

    if args.dry_run:
        return 0

    status, body = post_bulk_events(
        events,
        api_key=api_key,  # type: ignore
        athlete_id=args.athlete_id,
        base_url=args.base_url,
        upsert=not args.no_upsert,
        timeout=args.timeout,
    )

    if args.verbose:
        print(f"HTTP {status}")

    # Intervals typically returns counts on success
    if isinstance(body, dict):
        created = body.get("created")
        updated = body.get("updated")
        if created is not None or updated is not None:
            print(f"Created: {created}  Updated: {updated}")
        else:
            print(json.dumps(body, indent=2))
    else:
        print(body)

    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
