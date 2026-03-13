"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Pane, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import { type ShipmentMapFeature } from "@/lib/api";
import { getRiskConfig } from "@/lib/utils";


function FitToRoutes({ shipments }: { shipments: ShipmentMapFeature[] }) {
  const map = useMap();

  useEffect(() => {
    const points = shipments.flatMap((shipment) => {
      const routePoints = shipment.route.coordinates
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
        .map(([lng, lat]) => [lat, lng] as LatLngExpression);
      const markers = [shipment.origin, shipment.destination]
        .filter((point) => point.lat != null && point.lng != null)
        .map((point) => [point.lat as number, point.lng as number] as LatLngExpression);
      return [...routePoints, ...markers];
    });

    if (points.length >= 2) {
      map.fitBounds(points as LatLngBoundsExpression, { padding: [32, 32] });
    }
  }, [map, shipments]);

  return null;
}

export default function ShipmentMap({
  shipments,
  selectedShipmentId,
  onSelect,
}: {
  shipments: ShipmentMapFeature[];
  selectedShipmentId?: string | null;
  onSelect: (shipment: ShipmentMapFeature) => void;
}) {
  return (
    <MapContainer
      center={[20, 10]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      className="h-[560px] w-full bg-[#030712]"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <Pane name="routes" style={{ zIndex: 410 }} />
      <Pane name="markers" style={{ zIndex: 420 }} />

      {shipments.map((shipment) => {
        const config = getRiskConfig(shipment.status);
        const selected = selectedShipmentId === shipment.shipment_id;
        const positions = shipment.route.coordinates
          .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
          .map(([lng, lat]) => [lat, lng] as LatLngExpression);

        return (
          <div key={shipment.shipment_id}>
            {positions.length >= 2 && (
              <Polyline
                pane="routes"
                pathOptions={{
                  color: config.bar,
                  opacity: selected ? 0.95 : 0.7,
                  weight: selected ? 5 : 3,
                }}
                positions={positions}
                eventHandlers={{ click: () => onSelect(shipment) }}
              >
                <Tooltip sticky>
                  <div className="text-[11px]">
                    <div>{shipment.shipment_id}</div>
                    <div>{shipment.origin.city} to {shipment.destination.city}</div>
                    <div>{shipment.status}</div>
                  </div>
                </Tooltip>
              </Polyline>
            )}

            {[shipment.origin, shipment.destination].map((point, idx) => (
              point.lat != null && point.lng != null ? (
                <CircleMarker
                  key={`${shipment.shipment_id}-${idx}`}
                  pane="markers"
                  center={[point.lat, point.lng]}
                  radius={selected ? 7 : 5}
                  pathOptions={{
                    color: selected ? "#f8fafc" : config.bar,
                    weight: 1.5,
                    fillColor: config.bar,
                    fillOpacity: 0.85,
                  }}
                  eventHandlers={{ click: () => onSelect(shipment) }}
                >
                  <Tooltip direction={idx === 0 ? "top" : "bottom"}>
                    <div className="text-[11px]">
                      <div>{idx === 0 ? "Origin" : "Destination"}</div>
                      <div>{point.port || point.city}</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ) : null
            ))}
          </div>
        );
      })}

      <FitToRoutes shipments={shipments} />
    </MapContainer>
  );
}
