# ABMGIS Rain-60

ABMGIS Rain-60 là bản nâng cấp web-native của mô hình `segregationDC.nlogo` trong `Week 6.zip`.

## Khác biệt quan trọng

Bản cũ dùng màu polygon như trạng thái đại diện cho tác tử. Rain-60 tách hai lớp state:

- **GIS Environment**: 188 polygon, topology láng giềng, mưa tích lũy, khả năng thoát nước, mức ngập, khả năng tiếp cận và shelter.
- **Agents**: 150 tác tử Đỏ/Xanh có ID, home zone, ngưỡng xã hội, ngưỡng chịu ngập, mobility, trạng thái quyết định, mục tiêu, route và trail.

Polygon vì vậy không còn là agent. Đỏ/Xanh được render bằng point layer độc lập.

## Chu trình 1 tick = 1 phút

```text
rain
  -> hydrology
  -> accessibility
  -> perceive social + flood state
  -> evaluate spatial utility
  -> decide stay / relocate / evacuate
  -> move one topology edge
  -> update exposure
  -> render MapLibre
```

Kịch bản mặc định chạy 60 tick = 60 phút mưa liên tục.

## Utility của agent

Mỗi agent đánh giá vị trí từ ba thành phần chính:

- mức tương đồng xã hội (Schelling),
- độ an toàn trước ngập,
- khả năng tiếp cận.

Khi hazard tăng, trọng số an toàn tăng và trọng số xã hội giảm. Agent có thể tái định cư vì không hài lòng xã hội hoặc sơ tán vì mức ngập vượt ngưỡng chịu đựng.

## Lưu ý khoa học

Các trường `terrain`, `drainage`, `impervious` và phương trình tích nước trong demo được sinh xác định từ hình học/ID để minh họa kiến trúc ABMGIS. Chúng **không phải dữ liệu DEM, cống thoát nước hay mô hình thủy lực thực địa**.

Để dùng cho nghiên cứu/điều hành thực tế, thay lớp môi trường minh họa bằng DEM/DTM, land cover, drainage, rainfall radar/gauge, road graph, hydrodynamic model hoặc sensor data đã được kiểm định.

## Stack

- NetLogo: reference model Schelling
- MapLibre GL JS: render GIS
- PMTiles protocol: basemap delivery
- GeoJSON: vector environment
- JavaScript: browser ABM runtime
- GitHub Pages: static hosting