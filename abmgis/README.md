# ABM GIS — NetLogo × PMTiles

Trang GitHub Pages mô phỏng **Agent-Based Modeling + GIS**, chuyển từ `Week 6/segregationDC.nlogo`.

- 188 polygon Washington, DC: 75 đỏ, 75 xanh, 38 trống.
- Luật Schelling và topology láng giềng giữ theo bài gốc.
- **NetLogo Web 2.16.0** dùng `GIS` + `Fetch`, đọc GeoJSON qua `gis:load-dataset-from-string`.
- **MapLibre GL JS + PMTiles** hiển thị nền GIS; trạng thái ABM cập nhật bằng GeoJSON theo từng tick.
- Sửa lỗi monitor gốc: turtle dùng `tcolor`, không phải `mycolor`.

GitHub Pages được triển khai từ thư mục này bằng workflow `.github/workflows/pages-abmgis.yml`.
