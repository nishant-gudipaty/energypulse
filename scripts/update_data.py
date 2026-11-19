#!/usr/bin/env python3
"""
EnergyPulse daily data robot.

Runs on GitHub Actions (or your laptop) and rewrites the JSON files in data/live/.
Uses only the Python standard library, so there is nothing to install.

Rules:
  * Only real, attributed data is written to data/live/. Demo data lives in
    data/demo/ and is never mixed in.
  * If a source fails, the previous day's file is kept and marked "stale".
    Nothing is ever filled in with made-up numbers.

Usage:
  python scripts/update_data.py          # fetch everything
  EIA_API_KEY=xxxx python scripts/update_data.py   # also fetch Brent / WTI
"""
from __future__ import annotations

import csv
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LIVE = DATA / "live"
LIVE.mkdir(parents=True, exist_ok=True)

IST = timezone(timedelta(hours=5, minutes=30))
NOW = datetime.now(timezone.utc)
UA = "Mozilla/5.0 (EnergyPulse data robot; +https://github.com/)"
TIMEOUT = 30

PPAC_PRICES_URL = "https://ppac.gov.in/prices/international-prices-of-crude-oil"
PPAC_NEWS_URL = "https://ppac.gov.in/archives/impnews"

# ---------------------------------------------------------------- helpers


def log(msg: str) -> None:
    print(f"[{datetime.now(IST):%H:%M:%S}] {msg}", flush=True)


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def keep_previous_as_stale(path: Path, error: str) -> dict:
    """Source failed today: keep yesterday's real data, flag it stale."""
    prev = read_json(path)
    if prev and prev.get("mode") == "live":
        prev["status"] = "stale"
        prev["last_error"] = error
        prev["checked_at"] = iso(NOW)
        write_json(path, prev)
        return prev
    obj = {"mode": "live", "status": "error", "last_error": error, "checked_at": iso(NOW)}
    write_json(path, obj)
    return obj


# ---------------------------------------------------- 1. Indian Crude Basket

BASKET_CSV = DATA / "indian_basket_daily.csv"       # date,usd_per_bbl,source
MONTHLY_CSV = DATA / "indian_basket_monthly.csv"    # month,usd_per_bbl,source
COMPOSITION_JSON = DATA / "indian_basket_composition.json"

DAILY_RE = re.compile(
    r"Indian\s+Basket\s+as\s+on\s+(\d{2})[.\-/](\d{2})[.\-/](\d{4})\s+is\s+(?:US)?\$\s*([\d]+(?:\.\d+)?)",
    re.I,
)


def read_daily_csv() -> dict[str, dict]:
    rows: dict[str, dict] = {}
    if BASKET_CSV.exists():
        with BASKET_CSV.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                d = (r.get("date") or "").strip()
                v = (r.get("usd_per_bbl") or "").strip()
                if not d or not v or d.startswith("#"):
                    continue
                try:
                    rows[d] = {"date": d, "usd": round(float(v), 2), "source": (r.get("source") or "PPAC").strip()}
                except ValueError:
                    log(f"  ! skipping bad CSV row: {r}")
    return rows


def write_daily_csv(rows: dict[str, dict]) -> None:
    with BASKET_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "usd_per_bbl", "source"])
        for d in sorted(rows):
            w.writerow([d, f'{rows[d]["usd"]:.2f}', rows[d]["source"]])


def scrape_ppac_daily() -> list[dict]:
    """Look for 'Crude Oil Indian Basket as on DD.MM.YYYY is $xx.xx/bbl' on PPAC pages."""
    found: list[dict] = []
    for url in (PPAC_PRICES_URL, PPAC_NEWS_URL):
        try:
            text = html.unescape(http_get(url).decode("utf-8", "ignore"))
        except Exception as e:  # noqa: BLE001
            log(f"  ! PPAC {url} failed: {e}")
            continue
        for dd, mm, yyyy, val in DAILY_RE.findall(text):
            found.append({"date": f"{yyyy}-{mm}-{dd}", "usd": round(float(val), 2), "source": "PPAC"})
    return found


def update_basket() -> dict:
    log("Indian Crude Basket")
    rows = read_daily_csv()
    scraped = scrape_ppac_daily()
    added = 0
    for r in scraped:
        if r["date"] not in rows:
            rows[r["date"]] = r
            added += 1
    if added:
        write_daily_csv(rows)
    log(f"  scraped {len(scraped)} PPAC entries, {added} new; {len(rows)} days on file")

    monthly = []
    if MONTHLY_CSV.exists():
        with MONTHLY_CSV.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    monthly.append({"month": r["month"].strip(), "usd": round(float(r["usd_per_bbl"]), 2)})
                except (KeyError, ValueError):
                    pass
    monthly.sort(key=lambda r: r["month"])

    history = [{"date": d, "usd": rows[d]["usd"]} for d in sorted(rows)]
    latest = history[-1] if history else None
    status = "error"
    if latest:
        age = (NOW.date() - datetime.strptime(latest["date"], "%Y-%m-%d").date()).days
        status = "ok" if age <= 5 else "stale"

    obj = {
        "mode": "live",
        "status": status,
        "checked_at": iso(NOW),
        "unit": "USD/bbl",
        "latest": latest,
        "previous": history[-2] if len(history) > 1 else None,
        "history": history[-400:],
        "monthly": monthly,
        "composition": read_json(COMPOSITION_JSON),
        "source": {"name": "Petroleum Planning & Analysis Cell (PPAC), MoPNG", "url": PPAC_PRICES_URL},
        "note": "Daily values come from PPAC. If the robot cannot read PPAC, add a row to "
                "data/indian_basket_daily.csv on GitHub and the site updates within minutes.",
    }
    if not latest:
        obj["last_error"] = "No Indian Basket values on file yet"
    write_json(LIVE / "basket.json", obj)
    return obj


# ---------------------------------------------- 2. Brent / WTI (EIA) + USD/INR

EIA_SERIES = {
    "brent": ("RBRTE", "Brent (Europe spot FOB)"),
    "wti": ("RWTC", "WTI (Cushing spot)"),
}


def fetch_eia(series_id: str, key: str) -> list[dict]:
    params = [
        ("api_key", key), ("frequency", "daily"), ("data[0]", "value"),
        ("facets[series][]", series_id), ("sort[0][column]", "period"),
        ("sort[0][direction]", "desc"), ("offset", "0"), ("length", "260"),
    ]
    url = "https://api.eia.gov/v2/petroleum/pri/spt/data/?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    out = []
    for r in data.get("response", {}).get("data", []):
        try:
            out.append({"date": r["period"], "usd": round(float(r["value"]), 2)})
        except (KeyError, TypeError, ValueError):
            continue
    out.sort(key=lambda r: r["date"])
    if not out:
        raise RuntimeError(f"EIA returned no data for {series_id}")
    return out


def fetch_usdinr() -> list[dict]:
    start = (NOW - timedelta(days=400)).date().isoformat()
    for url in (
        f"https://api.frankfurter.dev/v1/{start}..?base=USD&symbols=INR",
        f"https://api.frankfurter.app/{start}..?from=USD&to=INR",
    ):
        try:
            data = json.loads(http_get(url))
            rates = data.get("rates", {})
            out = [{"date": d, "value": round(v["INR"], 4)} for d, v in sorted(rates.items()) if "INR" in v]
            if out:
                return out
        except Exception as e:  # noqa: BLE001
            log(f"  ! FX {url} failed: {e}")
    raise RuntimeError("USD/INR source unavailable")


def update_markets() -> dict:
    log("Markets (Brent, WTI, USD/INR)")
    path = LIVE / "markets.json"
    prev = read_json(path) or {}
    prev_series = {s["id"]: s for s in prev.get("series", [])} if prev.get("mode") == "live" else {}
    key = os.environ.get("EIA_API_KEY", "").strip()
    series = []

    for sid, (eia_id, label) in EIA_SERIES.items():
        base = {"id": sid, "name": label, "unit": "USD/bbl",
                "source": {"name": "U.S. Energy Information Administration (EIA)",
                           "url": "https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm"}}
        if not key:
            series.append({**base, "status": "not_configured",
                           "last_error": "Add a free EIA_API_KEY secret to enable this series"})
            continue
        try:
            hist = fetch_eia(eia_id, key)
            series.append({**base, "status": "ok", "history": hist, "latest": hist[-1],
                           "previous": hist[-2] if len(hist) > 1 else None})
            log(f"  {sid}: {hist[-1]}")
        except Exception as e:  # noqa: BLE001
            log(f"  ! {sid} failed: {e}")
            old = prev_series.get(sid)
            if old and old.get("history"):
                series.append({**old, "status": "stale", "last_error": str(e)})
            else:
                series.append({**base, "status": "error", "last_error": str(e)})

    fx_base = {"id": "usdinr", "name": "USD / INR (ECB reference)", "unit": "INR per USD",
               "source": {"name": "European Central Bank via Frankfurter API", "url": "https://frankfurter.dev"}}
    try:
        hist = [{"date": r["date"], "usd": r["value"]} for r in fetch_usdinr()]
        series.append({**fx_base, "status": "ok", "history": hist, "latest": hist[-1],
                       "previous": hist[-2] if len(hist) > 1 else None})
        log(f"  usdinr: {hist[-1]}")
    except Exception as e:  # noqa: BLE001
        old = prev_series.get("usdinr")
        series.append({**old, "status": "stale", "last_error": str(e)} if old and old.get("history")
                      else {**fx_base, "status": "error", "last_error": str(e)})

    if any(s["status"] == "ok" for s in series):
        overall = "ok"
    elif any(s.get("history") for s in series):
        overall = "stale"
    else:
        overall = "error"
    obj = {"mode": "live", "status": overall,
           "checked_at": iso(NOW), "series": series}
    write_json(path, obj)
    return obj


# ------------------------------------------------------------------- 3. News

NEWS_FEEDS = [
    # (category, Google News search query)
    ("india", '(oil OR gas OR refinery OR LNG OR "crude oil") India when:3d'),
    ("india", '"Indian Oil" OR IOCL OR BPCL OR HPCL OR ONGC when:3d'),
    ("global", '(OPEC OR "crude oil" OR Brent OR LNG OR refinery) when:2d'),
    ("ppac", '"Petroleum Planning and Analysis Cell" OR PPAC petroleum when:30d'),
    ("cht", '"Centre for High Technology" OR "Center for High Technology" oil when:60d'),
    ("safety", '(refinery OR petrochemical OR "chemical plant" OR cracker) (fire OR explosion OR blast OR leak OR "gas leak") when:7d'),
]

CATEGORY_LABELS = {
    "india": "India", "global": "Global", "ppac": "PPAC", "cht": "CHT", "safety": "Safety incident",
}


PRIORITY = {"global": 0, "india": 1, "cht": 2, "ppac": 3, "safety": 4}
SAFETY_WORDS = re.compile(
    r"\b(fire|blaze|explosion|explodes?|blast|leak|leakage|spill|toxic|killed|dead|injur\w*|evacuat\w*|accident|mishap|incident)\b",
    re.I)


def google_news_url(q: str) -> str:
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"})


def parse_rss(xml_bytes: bytes, category: str) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -(len(source) + 3)]
        pub = it.findtext("pubDate") or ""
        try:
            published = iso(email.utils.parsedate_to_datetime(pub))
        except Exception:  # noqa: BLE001
            published = None
        if not title or not link:
            continue
        items.append({
            "id": hashlib.sha1(title.lower().encode()).hexdigest()[:12],
            "title": html.unescape(title), "link": link, "source": source or "Google News",
            "published": published, "category": category,
        })
    return items


PPAC_ITEM_RE = re.compile(r"<a[^>]+href=\"([^\"]+)\"[^>]*>\s*([^<]{12,300}?)\s*</a>", re.I)


def scrape_ppac_news() -> list[dict]:
    """PPAC 'Important News' archive: official notices straight from PPAC."""
    text = http_get(PPAC_NEWS_URL).decode("utf-8", "ignore")
    items, seen = [], set()
    keywords = ("basket", "price", "rsp", "gas", "lpg", "icb", "ratio", "import", "consumption", "report")
    for href, title in PPAC_ITEM_RE.findall(text):
        t = html.unescape(re.sub(r"\s+", " ", title)).strip()
        if t.lower() in seen or not any(k in t.lower() for k in keywords):
            continue
        seen.add(t.lower())
        link = urllib.parse.urljoin(PPAC_NEWS_URL, href)
        items.append({"id": hashlib.sha1(t.lower().encode()).hexdigest()[:12], "title": t, "link": link,
                      "source": "PPAC (official)", "published": None, "category": "ppac"})
        if len(items) >= 15:
            break
    return items


def update_news() -> dict:
    log("News")
    path = LIVE / "news.json"
    all_items: dict[str, dict] = {}
    errors = []
    ok_feeds = 0
    for cat, q in NEWS_FEEDS:
        try:
            items = parse_rss(http_get(google_news_url(q)), cat)
            ok_feeds += 1
            for it in items[:25]:
                if cat == "safety" and not SAFETY_WORDS.search(it["title"]):
                    continue  # the search matched, but the headline isn't about an incident
                prev = all_items.get(it["id"])
                if prev and PRIORITY[prev["category"]] >= PRIORITY[cat]:
                    continue  # keep the more specific tag (safety > PPAC > CHT > India > Global)
                all_items[it["id"]] = it
            log(f"  {cat}: {len(items)} items")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{cat}: {e}")
            log(f"  ! {cat} failed: {e}")
    try:
        ppac = scrape_ppac_news()
        ok_feeds += 1
        for it in ppac:
            all_items.setdefault(it["id"], it)
        log(f"  ppac official: {len(ppac)} items")
    except Exception as e:  # noqa: BLE001
        errors.append(f"ppac official: {e}")

    if ok_feeds == 0:
        return keep_previous_as_stale(path, "; ".join(errors))

    cutoff = NOW - timedelta(days=60)
    items = [i for i in all_items.values()
             if not i["published"] or datetime.fromisoformat(i["published"].replace("Z", "+00:00")) >= cutoff]
    items.sort(key=lambda i: i["published"] or "", reverse=True)
    obj = {
        "mode": "live", "status": "ok" if not errors else "partial", "checked_at": iso(NOW),
        "categories": CATEGORY_LABELS, "items": items[:150],
        "source": {"name": "Google News RSS + PPAC official notices",
                   "note": "Headlines link to the original publisher. EnergyPulse does not copy article text."},
    }
    if errors:
        obj["last_error"] = "; ".join(errors)
    write_json(path, obj)
    return obj


# ------------------------------------------------------------------- main


def main() -> int:
    results = {}
    for name, fn in (("basket", update_basket), ("markets", update_markets), ("news", update_news)):
        try:
            r = fn()
            results[name] = {"status": r.get("status"), "error": r.get("last_error")}
        except Exception as e:  # noqa: BLE001  never let one source kill the run
            log(f"!! {name} crashed: {e}")
            keep_previous_as_stale(LIVE / f"{name}.json", str(e))
            results[name] = {"status": "error", "error": str(e)}

    write_json(LIVE / "meta.json", {
        "mode": "live", "generated_at": iso(NOW),
        "generated_at_ist": datetime.now(IST).strftime("%d %b %Y, %I:%M %p IST"),
        "sources": results,
    })
    log(f"Done: {json.dumps(results)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
