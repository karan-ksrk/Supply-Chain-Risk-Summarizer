"""
data/shipments.py
-----------------
Sample shipment data. In your real app, this would be loaded
from a CSV upload or database.
"""

SAMPLE_SHIPMENTS = [
    {
        "shipment_id": "SH-2041",
        "vendor": "Foxconn Ltd",
        "origin_city": "Shanghai", "origin_country": "China",
        "dest_city": "Rotterdam", "dest_country": "Netherlands",
        "origin_port": "Port of Shanghai", "dest_port": "Port of Rotterdam",
        "carrier": "Maersk Line", "transport_mode": "Sea",
        "sku": "PCB-Module-X1", "sku_category": "Electronics",
        "route": "Asia-Europe",
        "departure_date": "2026-02-28", "eta": "2026-03-14",
        "freight_cost_usd": 48000,
    },
    {
        "shipment_id": "SH-1892",
        "vendor": "Samsung Logistics",
        "origin_city": "Busan", "origin_country": "South Korea",
        "dest_city": "Los Angeles", "dest_country": "USA",
        "origin_port": "Busan Port", "dest_port": "Port of LA",
        "carrier": "HMM", "transport_mode": "Sea",
        "sku": "OLED-Panel-S9", "sku_category": "Electronics",
        "route": "Trans-Pacific",
        "departure_date": "2026-03-01", "eta": "2026-03-11",
        "freight_cost_usd": 32000,
    },
    {
        "shipment_id": "SH-2103",
        "vendor": "Tata Steel",
        "origin_city": "Mumbai", "origin_country": "India",
        "dest_city": "Hamburg", "dest_country": "Germany",
        "origin_port": "Nhava Sheva", "dest_port": "Hamburg Port",
        "carrier": "CMA CGM", "transport_mode": "Sea",
        "sku": "Steel-Sheet-3mm", "sku_category": "Raw Material",
        "route": "Indian Ocean",
        "departure_date": "2026-03-03", "eta": "2026-03-18",
        "freight_cost_usd": 21000,
    },
    {
        "shipment_id": "SH-1774",
        "vendor": "TSMC Express",
        "origin_city": "Taipei", "origin_country": "Taiwan",
        "dest_city": "Frankfurt", "dest_country": "Germany",
        "origin_port": "Taoyuan Airport", "dest_port": "Frankfurt Airport",
        "carrier": "DHL Aviation", "transport_mode": "Air",
        "sku": "Chip-A17-Pro", "sku_category": "Semiconductors",
        "route": "Air Freight",
        "departure_date": "2026-03-07", "eta": "2026-03-12",
        "freight_cost_usd": 95000,
    },
    {
        "shipment_id": "SH-2287",
        "vendor": "Li & Fung",
        "origin_city": "Guangzhou", "origin_country": "China",
        "dest_city": "New York", "dest_country": "USA",
        "origin_port": "Yantian Port", "dest_port": "Port of NY",
        "carrier": "COSCO", "transport_mode": "Sea",
        "sku": "Textile-Bundle-G4", "sku_category": "Apparel",
        "route": "Trans-Pacific",
        "departure_date": "2026-03-05", "eta": "2026-03-20",
        "freight_cost_usd": 18000,
    },
    {
        "shipment_id": "SH-2310",
        "vendor": "Maersk Cargo",
        "origin_city": "Copenhagen", "origin_country": "Denmark",
        "dest_city": "Singapore", "dest_country": "Singapore",
        "origin_port": "Copenhagen Port", "dest_port": "PSA Singapore",
        "carrier": "Maersk Line", "transport_mode": "Sea",
        "sku": "Machinery-Part-88", "sku_category": "Industrial",
        "route": "Europe-Asia",
        "departure_date": "2026-03-04", "eta": "2026-03-22",
        "freight_cost_usd": 27000,
    },
    {
        "shipment_id": "SH-2089",
        "vendor": "Apple Supply Co",
        "origin_city": "Shenzhen", "origin_country": "China",
        "dest_city": "Chicago", "dest_country": "USA",
        "origin_port": "Yantian Port", "dest_port": "Port of Chicago",
        "carrier": "FedEx Ocean", "transport_mode": "Sea",
        "sku": "Logic-Board-M4", "sku_category": "Electronics",
        "route": "Trans-Pacific",
        "departure_date": "2026-02-25", "eta": "2026-03-10",
        "freight_cost_usd": 62000,
    },
    {
        "shipment_id": "SH-3001",
        "vendor": "Vale Mining",
        "origin_city": "Carajas", "origin_country": "Brazil",
        "dest_city": "Qingdao", "dest_country": "China",
        "origin_port": "Ponta da Madeira", "dest_port": "Qingdao Port",
        "carrier": "COSCO", "transport_mode": "Sea",
        "sku": "Iron-Ore-Grade-A", "sku_category": "Raw Material",
        "route": "South America-Asia",
        "departure_date": "2026-02-28", "eta": "2026-03-16",
        "freight_cost_usd": 210000,
    },
]


def load_shipments_from_csv(filepath: str) -> list[dict]:
    """Load shipments from a CSV file instead of sample data."""
    import csv
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]
