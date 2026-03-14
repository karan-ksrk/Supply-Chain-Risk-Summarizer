import math
from typing import Any
from functools import lru_cache

import requests
from sqlalchemy.orm import Session

from backend.db import crud

try:
    import searoute as sr
except Exception:
    sr = None


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
REQUEST_TIMEOUT = 12.0


KNOWN_LOCATIONS: dict[str, tuple[float, float]] = {
    "incheon|south korea": (37.4563, 126.7052),
    "port of ras tanura|saudi arabia": (26.6436, 50.1583),
    "ras tanura|saudi arabia": (26.6436, 50.1583),
    "port of ingleside|united states": (27.8811, -97.2143),
    "ingleside|united states": (27.8775, -97.2086),
    "lekki|nigeria": (6.4281, 3.4573),
    "ju'aymah oil field terminal|saudi arabia": (27.1012, 49.8844),
    "juaymah oil field terminal|saudi arabia": (27.1012, 49.8844),
    "durban|south africa": (-29.8717, 31.0262),
    "port of durban|south africa": (-29.8717, 31.0262),
    "anegasaki keiyo sea berth|japan": (35.5258, 140.0227),
    "anegasaki|japan": (35.5230, 140.0384),
    "port of chiba|japan": (35.6073, 140.1064),
    "chiba|japan": (35.6073, 140.1064),
    "qua iboe anchorage|nigeria": (4.3159, 8.3381),
    "qua iboe|nigeria": (4.3123, 8.3077),
    "port of cilacap|indonesia": (-7.7230, 109.0154),
    "cilacap|indonesia": (-7.7230, 109.0154),
    "shuaiba anchorage|kuwait": (29.0436, 48.1549),
    "shuaiba|kuwait": (29.0411, 48.1497),
    "suez canal|egypt": (30.4350, 32.3497),
    "port said anchorage|egypt": (31.2653, 32.3019),
    "port said|egypt": (31.2653, 32.3019),
    "sikka port|india": (22.4295, 69.8214),
    "sikka|india": (22.4295, 69.8214),
}


def _norm(value: str | None) -> str:
    return (value or "").strip().lower().replace(".", "").replace("  ", " ")


def _coord_key(name: str | None, country: str | None = None) -> str:
    parts = [_norm(name)]
    if country:
        parts.append(_norm(country))
    return "|".join(part for part in parts if part)


def _lookup_known(port: str | None, city: str | None, country: str | None) -> tuple[float, float] | None:
    candidates = [
        _coord_key(port, country),
        _coord_key(city, country),
        _coord_key(port),
        _coord_key(city),
    ]
    for candidate in candidates:
        if candidate in KNOWN_LOCATIONS:
            return KNOWN_LOCATIONS[candidate]
    return None


@lru_cache(maxsize=1024)
def _geocode(query: str) -> tuple[float, float] | None:
    if not query:
        return None
    try:
        res = requests.get(
            NOMINATIM_URL,
            params={"q": query, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": "supply-chain-risk-summarizer/1.0"},
            timeout=REQUEST_TIMEOUT,
        )
        res.raise_for_status()
        items = res.json()
    except Exception:
        return None

    if not items:
        return None

    top = items[0]
    try:
        return (float(top["lat"]), float(top["lon"]))
    except Exception:
        return None


def resolve_point(port: str | None, city: str | None, country: str | None) -> tuple[float, float] | None:
    known = _lookup_known(port, city, country)
    if known:
        return known

    queries = [
        ", ".join(part for part in [port, city, country] if part),
        ", ".join(part for part in [city, country] if part),
        ", ".join(part for part in [port, country] if part),
    ]
    for query in queries:
        point = _geocode(query)
        if point:
            return point
    return None


def _route_key(shipment: dict) -> str:
    origin = _coord_key(shipment.get("origin_port") or shipment.get("origin_city"), shipment.get("origin_country"))
    dest = _coord_key(shipment.get("dest_port") or shipment.get("dest_city"), shipment.get("dest_country"))
    mode = _norm(shipment.get("transport_mode") or "unknown")
    return f"{mode}:{origin}->{dest}"


def _haversine_nm(origin: tuple[float, float], dest: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, origin)
    lat2, lon2 = map(math.radians, dest)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3440.065 * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def _fallback_coordinates(origin: tuple[float, float], dest: tuple[float, float]) -> list[list[float]]:
    return [[origin[1], origin[0]], [dest[1], dest[0]]]


def _normalize_geojson(geojson: dict[str, Any]) -> list[list[float]]:
    if not geojson:
        return []

    features = geojson.get("features")
    if isinstance(features, list):
        for feature in features:
            coords = _normalize_geometry(feature.get("geometry") or {})
            if coords:
                return coords

    return _normalize_geometry(geojson.get("geometry") or geojson)


def _normalize_geometry(geometry: dict[str, Any]) -> list[list[float]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "LineString" and isinstance(coords, list):
        flattened: list[list[float]] = []
        for point in coords:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                flattened.append([float(point[0]), float(point[1])])
        return flattened
    if gtype == "MultiLineString" and isinstance(coords, list):
        flattened: list[list[float]] = []
        for segment in coords:
            for point in segment:
                if len(point) >= 2:
                    flattened.append([float(point[0]), float(point[1])])
        return flattened
    return []


def _extract_distance_nm(geojson: dict[str, Any]) -> float | None:
    features = geojson.get("features") if isinstance(geojson, dict) else None
    candidates = []
    if isinstance(features, list):
        candidates.extend(feature.get("properties", {}) for feature in features)
    if isinstance(geojson, dict):
        candidates.append(geojson.get("properties", {}))

    for props in candidates:
        for key in ("distance_nm", "distanceNauticalMiles", "length_nm", "length", "distance"):
            value = props.get(key)
            if value is not None:
                try:
                    return float(value)
                except Exception:
                    continue
    return None


def _build_searoute_geojson(origin: tuple[float, float], dest: tuple[float, float]) -> dict[str, Any] | None:
    if sr is None:
        return None

    try:
        feature = sr.searoute(
            [origin[1], origin[0]],
            [dest[1], dest[0]],
            units="naut",
            append_orig_dest=True,
            return_passages=True,
        )
    except Exception:
        return None

    return dict(feature) if isinstance(feature, dict) else None


def build_map_feature(
    db: Session,
    shipment: dict,
    report: dict | None = None,
    *,
    auto_commit: bool = True,
) -> dict:
    route_key = _route_key(shipment)
    cached = crud.get_route_cache(db, route_key)

    if cached is not None:
        origin = {"lat": cached.origin_lat, "lng": cached.origin_lng}
        dest = {"lat": cached.dest_lat, "lng": cached.dest_lng}
        route = {
            "kind": cached.route_kind,
            "coordinates": cached.normalized_coordinates or [],
            "distance_nm": cached.distance_nm,
            "source": cached.route_source,
        }
    else:
        origin_point = resolve_point(shipment.get("origin_port"), shipment.get("origin_city"), shipment.get("origin_country"))
        dest_point = resolve_point(shipment.get("dest_port"), shipment.get("dest_city"), shipment.get("dest_country"))

        route_kind = "fallback"
        route_source = "fallback"
        raw_geojson = None
        distance_nm = None
        coordinates: list[list[float]] = []

        if origin_point and dest_point:
            if _norm(shipment.get("transport_mode")) == "sea":
                raw_geojson = _build_searoute_geojson(origin_point, dest_point)
                coordinates = _normalize_geojson(raw_geojson or {})
                if coordinates:
                    route_kind = "searoute"
                    route_source = "searoute-library"
                    distance_nm = _extract_distance_nm(raw_geojson or {})

            if not coordinates:
                coordinates = _fallback_coordinates(origin_point, dest_point)
                distance_nm = distance_nm or _haversine_nm(origin_point, dest_point)

            origin = {"lat": origin_point[0], "lng": origin_point[1]}
            dest = {"lat": dest_point[0], "lng": dest_point[1]}
            route = {
                "kind": route_kind,
                "coordinates": coordinates,
                "distance_nm": distance_nm,
                "source": route_source,
            }
        else:
            origin = {"lat": None, "lng": None}
            dest = {"lat": None, "lng": None}
            route = {"kind": "fallback", "coordinates": [], "distance_nm": None, "source": "fallback"}

        crud.upsert_route_cache(db, {
            "route_key": route_key,
            "transport_mode": shipment.get("transport_mode") or "Unknown",
            "origin_query": ", ".join(part for part in [shipment.get("origin_port"), shipment.get("origin_city"), shipment.get("origin_country")] if part),
            "dest_query": ", ".join(part for part in [shipment.get("dest_port"), shipment.get("dest_city"), shipment.get("dest_country")] if part),
            "origin_lat": origin["lat"],
            "origin_lng": origin["lng"],
            "dest_lat": dest["lat"],
            "dest_lng": dest["lng"],
            "route_kind": route["kind"],
            "route_source": route["source"],
            "distance_nm": route["distance_nm"],
            "raw_geojson": raw_geojson,
            "normalized_coordinates": route["coordinates"],
            "route_metadata": {"provider": route["source"], "resolved": bool(origin_point and dest_point)},
        }, commit=auto_commit)

    status = report.get("risk_level") if report else "PENDING"

    return {
        "shipment_id": shipment.get("shipment_id"),
        "vendor": shipment.get("vendor"),
        "transport_mode": shipment.get("transport_mode"),
        "carrier": shipment.get("carrier"),
        "eta": shipment.get("eta"),
        "origin": {
            "city": shipment.get("origin_city"),
            "country": shipment.get("origin_country"),
            "port": shipment.get("origin_port"),
            **origin,
        },
        "destination": {
            "city": shipment.get("dest_city"),
            "country": shipment.get("dest_country"),
            "port": shipment.get("dest_port"),
            **dest,
        },
        "route": route,
        "status": status,
        "risk_report": None if not report else {
            "shipment_id": report.get("shipment_id"),
            "risk_level": report.get("risk_level"),
            "delay_estimate": report.get("delay_estimate"),
            "primary_risk": report.get("primary_risk"),
            "explanation": report.get("explanation"),
            "suggested_action": report.get("suggested_action"),
            "confidence": report.get("confidence"),
            "matched_signals": report.get("matched_signals") or [],
        },
    }
