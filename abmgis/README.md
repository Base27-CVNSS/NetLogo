# ABMGIS AEIO-1000

Bản nâng cấp này dùng bài báo **“Mô hình hệ thống đa tác tử để mô phỏng giao thông đô thị”** (Nguyễn Thanh Tuấn, Hoàng Thị Thanh Hà, Lê Quang Vũ, 2014) làm khung lý thuyết cho kiến trúc đa tác tử.

## Khung AEIO

Mô hình tổ chức theo:

```text
MAS = Agent + Environment + Interaction + Organisation
```

### A — Agent

- 1.000 tác tử độc lập.
- Tác tử có loại phương tiện: xe máy, ô tô, xe tải, xe buýt.
- Thuộc tính riêng: tốc độ hiện tại, tốc độ mong muốn, tốc độ tối đa, gia tốc, giảm tốc, kích thước, khoảng cách an toàn, kiên nhẫn, mức hung hăng, mức tuân thủ, vùng quan sát, ngưỡng chịu ngập.
- Giữ `RED/BLUE` như một lớp thử nghiệm Schelling mở rộng; đây không phải nội dung của bài báo giao thông.

### E — Environment

- 188 polygon GIS gốc là **macro-environment**.
- Mỗi polygon sinh 6 **micro-environment** logic (3 làn × 2 hướng) → **1.128 vi môi trường**.
- Mỗi vi môi trường có làn, hướng, capacity và mật độ.
- Môi trường còn có mưa, ngập, khả năng tiếp cận, điểm trú ẩn và pha tín hiệu.

Các micro-environment hiện là lớp logic/hiển thị minh họa quanh centroid; chúng chưa phải lane geometry khảo sát thực địa.

### I — Interaction

Tác tử chỉ quyết định từ thông tin cục bộ:

- nhìn xe phía trước trong vùng quan sát,
- đánh giá khoảng cách an toàn,
- bám xe / giảm tốc / dừng,
- kiểm tra làn bên cạnh,
- đổi làn nếu có khoảng trống,
- nhận biết mật độ, ngập và khả năng tiếp cận,
- cảm nhận cấu trúc RED/BLUE trong vùng và vùng lân cận.

Không dùng vòng lặp “mọi agent nhìn toàn bộ 1.000 agent” cho hành vi giao thông; runtime tạo bucket theo microzone/macrozone để giữ tương tác cục bộ.

### O — Organisation

- tín hiệu giao thông logic theo vùng,
- khoảng cách an toàn,
- luật dừng/chờ,
- mức tuân thủ riêng của từng agent,
- ưu tiên an toàn khi ngập.

Thanh **Mức hỗn loạn** không biến chuyển động thành random. Khi tăng chaos:

- xác suất bỏ qua tín hiệu tăng,
- khoảng cách chấp nhận giảm,
- đổi làn cơ hội tăng,
- lựa chọn tuyến ít có tổ chức hơn,
- near-miss và congestion có thể nổi lên từ tương tác.

## Độ phân giải thời gian

Traffic microscopic simulation dùng:

```text
1 tick = 5 giây
720 tick = 60 phút
```

Độ phân giải này phù hợp hơn 1 phút/tick cho hành vi bám xe, đổi làn, tăng/giảm tốc.

## Chu trình mô phỏng

```text
environment update
  -> perceive local agents + GIS
  -> interaction
  -> organisation / compliance
  -> decide
  -> car-follow / lane-change / route
  -> move
  -> emergence metrics
  -> MapLibre render
```

## Emergence

Hệ thống không đặt trước kết quả cuối. Dashboard đo các kết quả nổi lên:

- tốc độ trung bình,
- tỷ lệ ùn tắc,
- near-miss,
- số đổi làn,
- số tác tử bám xe / chờ,
- sơ tán và trú ẩn,
- phơi nhiễm ngập,
- chỉ số rối loạn tổng hợp.

## Giới hạn khoa học

Bài báo cung cấp khung tác tử giao thông, môi trường, tương tác và tổ chức. **Bài báo không mô tả mưa/ngập hay Schelling**; hai phần này là mở rộng ABMGIS của dự án.

Dữ liệu `terrain`, `drainage`, `impervious`, lane/microzone và tín hiệu hiện được sinh xác định để chứng minh kiến trúc. Không dùng chúng cho dự báo giao thông/ngập thực tế. Để nghiên cứu thực địa cần thay bằng road/lane graph, signal timing, DEM/DTM, drainage, rainfall, traffic counts, vehicle trajectories và calibration/validation data.