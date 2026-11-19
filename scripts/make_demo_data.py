#!/usr/bin/env python3
"""Regenerates data/demo/*.json — clearly fake numbers for trying the app.
Run once; the daily robot never touches data/demo/."""
import json
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "demo"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(42)
today = date(2026, 11, 19)
now = datetime(2026, 11, 19, 2, 0, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def walk(start, n, vol):
    out, v, d = [], start, today - timedelta(days=int(n * 1.45))
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            v = max(1, v + random.gauss(0, vol))
            out.append({"date": d.isoformat(), "usd": round(v, 2)})
    return out


def series(id_, name, unit, start, vol):
    h = walk(start, 260, vol)
    return {"id": id_, "name": name + " — DEMO", "unit": unit, "status": "demo", "history": h,
            "latest": h[-1], "previous": h[-2], "source": {"name": "Illustrative demo data (not real prices)"}}


basket = walk(72, 260, 0.9)
months = {}
for p in basket:
    months.setdefault(p["date"][:7], []).append(p["usd"])
demo = "Illustrative demo data (not real prices)"
files = {
    "basket": {"mode": "demo", "status": "demo", "checked_at": now, "unit": "USD/bbl",
               "latest": basket[-1], "previous": basket[-2], "history": basket,
               "monthly": [{"month": m, "usd": round(sum(v) / len(v), 2)} for m, v in sorted(months.items())][-8:],
               "composition": {"ratios": [{"month": "2026-11", "ratio": "50.00 : 50.00"}],
                               "explanation": "DEMO — made-up ratio.", "source": {"name": demo, "url": "#"}},
               "source": {"name": demo}},
    "markets": {"mode": "demo", "status": "demo", "checked_at": now, "series": [
        series("brent", "Brent", "USD/bbl", 74, 1.0),
        series("wti", "WTI", "USD/bbl", 70, 1.0),
        series("usdinr", "USD / INR", "INR per USD", 86, 0.12)]},
    "news": {"mode": "demo", "status": "demo", "checked_at": now,
             "categories": {"india": "India", "global": "Global", "ppac": "PPAC", "cht": "CHT", "safety": "Safety incident"},
             "items": [
                 {"id": f"d{i}", "title": f"[DEMO] {t}", "link": "#/news", "source": "Demo feed",
                  "published": (datetime(2026, 11, 19, tzinfo=timezone.utc) - timedelta(hours=5 * i)).isoformat().replace("+00:00", "Z"),
                  "category": c}
                 for i, (c, t) in enumerate([
                     ("india", "Sample headline: refiners raise crude runs ahead of winter demand"),
                     ("ppac", "Sample PPAC notice: Indian Basket price published for the day"),
                     ("safety", "Sample incident: small fire at a hypothetical refinery unit, no injuries"),
                     ("global", "Sample headline: producer group holds output steady"),
                     ("cht", "Sample CHT update: energy-efficiency workshop for refineries"),
                     ("india", "Sample headline: city gas network expansion announced"),
                     ("safety", "Sample incident: hydrocarbon leak contained at hypothetical cracker unit"),
                     ("global", "Sample headline: LNG spot prices ease on mild weather"),
                 ])],
             "source": {"name": demo, "note": "All headlines on this page are invented for demonstration."}},
    "meta": {"mode": "demo", "generated_at": now, "generated_at_ist": "DEMO data", "sources": {}},
}
for name, obj in files.items():
    (OUT / f"{name}.json").write_text(json.dumps(obj, indent=1) + "\n")
print("demo data written to", OUT)
