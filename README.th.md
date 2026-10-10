# CLPS Lunar Mission Browser

[English](README.md) | **ภาษาไทย**

เว็บแสดงดวงจันทร์แบบ 3 มิติ สำหรับดู**พื้นที่ลงจอดที่เป็นตัวเลือกของ Artemis III** และภารกิจ **CLPS** (Commercial Lunar Payload Services - โครงการขนส่งสัมภาระสู่ดวงจันทร์เชิงพาณิชย์ของ NASA) พร้อม backend FastAPI สำหรับวิเคราะห์ทางฟิสิกส์ (พลังงานแสงอาทิตย์, การอยู่รอดของแบตเตอรี่, เวกเตอร์ ENU, ความชัน/TRI)

หน้าเว็บรองรับทั้ง**ภาษาอังกฤษและภาษาไทย** กดปุ่ม `EN | ไทย` มุมขวาบนเพื่อสลับภาษา (ระบบจะจำภาษาที่เลือกไว้) หรือเปิดลิงก์ด้วย `?lang=th` / `?lang=en`

```
clps-lunar-browser/
├── frontend/
│   ├── index.html        # โครงหน้า: แถบ KPI ด้านบน, รายการจุดลงจอด, ตัวแสดงผล 3 มิติ, แถบข้าง + แดชบอร์ดวิเคราะห์
│   ├── style.css         # ธีมมืดสไตล์ห้องควบคุมภารกิจอวกาศ
│   ├── app.js            # ดวงจันทร์ CesiumJS, หมุด 3 มิติ, คลิก -> แถบข้าง, เรียก API, กราฟ, ระบบสลับภาษา
│   ├── textures/moon_lroc_color_4k.jpg  # ภาพโมเสกสีของ NASA LROC (equirectangular)
│   └── sites_data.json   # 9 พื้นที่ Artemis III (+1 พื้นที่เดิม) และจุดลงจอด CLPS (IM-1, IM-2, Blue Ghost M1)
├── backend/
│   ├── main.py           # เซิร์ฟเวอร์ REST ด้วย FastAPI (เปิด CORS)
│   ├── physics.py        # พลังงานแสงอาทิตย์, การอยู่รอดของแบตเตอรี่, ME->ENU, ความชัน/TRI
│   └── requirements.txt
├── render.yaml           # ไฟล์ Blueprint สำหรับ deploy บน Render
└── README.md
```

## สิ่งที่ต้องมี

- Python 3.10 ขึ้นไป
- เบราว์เซอร์รุ่นใหม่ที่รองรับ WebGL
- อินเทอร์เน็ต (CesiumJS และฟอนต์โหลดจาก CDN)

## 1. Backend (FastAPI)

```bash
cd clps-lunar-browser/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

- เอกสาร API แบบโต้ตอบ: http://localhost:8000/docs
- ตรวจสอบสถานะ: http://localhost:8000/api/health
- backend เสิร์ฟหน้าเว็บ frontend ด้วย ดังนั้นเปิด http://localhost:8000 ก็ได้ทั้งแอป
  ถ้าต้องการแชร์ในวง LAN ให้รันด้วย `--host 0.0.0.0` แล้วเปิด `http://<IP-ของคุณ>:8000`

## 2. Frontend (ไฟล์ static)

ต้องเปิด frontend ผ่าน HTTP ไม่ใช่เปิดไฟล์ตรง ๆ แบบ `file://` เพราะ `fetch("sites_data.json")` ใช้กับ `file://` ไม่ได้ ให้เปิด terminal อีกหน้าต่างแล้วรัน:

```bash
cd clps-lunar-browser/frontend
python3 -m http.server 5500
```

จากนั้นเปิด http://localhost:5500

### ทางเลือก: ภูมิประเทศดวงจันทร์จริง

ค่าเริ่มต้นจะแสดงดวงจันทร์เป็นทรงกลมเรียบที่ใช้ภาพโมเสกสีจาก NASA LROC ([NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) เวอร์ชันแก้ไขบริเวณขั้ว แปลงเป็น JPG ขนาด 4k) พร้อมเส้นตารางละติจูด/ลองจิจูดจาง ๆ โหมดนี้ไม่ต้องสมัครบัญชีใด ๆ หากต้องการแสดง **Cesium Moon Terrain** แบบ 3D Tiles ความละเอียดสูง:

1. สร้างโทเคนฟรีที่ https://ion.cesium.com/tokens
2. เปิด `http://localhost:5500/?ion=โทเคนของคุณ` หรือตั้งค่า `CESIUM_ION_TOKEN` ใน `app.js`

## Deploy เป็นเว็บสาธารณะบน Render

1. ไปที่ https://dashboard.render.com แล้วกด **New +** → **Blueprint**
2. เชื่อมต่อ GitHub แล้วเลือก repo นี้ Render จะอ่าน `render.yaml` ให้อัตโนมัติ
3. กด **Apply** แล้วรอ build ประมาณ 3–5 นาที จะได้ URL สาธารณะ เช่น `https://clps-lunar-browser.onrender.com`

หมายเหตุ: แพ็กเกจฟรีจะหยุดเซิร์ฟเวอร์เมื่อไม่มีผู้ใช้งาน 15 นาที การเข้าครั้งถัดไปต้องรอประมาณ 30–60 วินาที และทุกครั้งที่ `git push` ขึ้น `main` จะ deploy ใหม่อัตโนมัติ

## API

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | ตรวจสอบสถานะ |
| GET | `/api/sites` | จุดลงจอดทั้งหมด อ่านจาก `frontend/sites_data.json` |
| GET | `/api/sites/{site_id}` | จุดลงจอดหนึ่งจุด |
| GET | `/api/site-analysis/{site_id}` | วิเคราะห์พลังงานแสงอาทิตย์และการอยู่รอดของแบตเตอรี่ |

พารามิเตอร์สำหรับ `/api/site-analysis/{site_id}` (ไม่บังคับทั้งหมด):

| พารามิเตอร์ | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `subsolar_lon_deg` | ลองจิจูดของจุดลงจอด | ตำแหน่งดวงอาทิตย์ (ลองจิจูดของจุดใต้ดวงอาทิตย์) |
| `subsolar_lat_deg` | 0 | ฤดูกาล (±1.54°) |
| `terrain_visibility` | 1.0 | ปัจจัยการบังแสงจากภูมิประเทศ 0–1 |
| `panel_mode` | `tracking` | `tracking` (หมุนตามดวงอาทิตย์) หรือ `fixed` (ติดตั้งตายตัว) |
| `panel_tilt_deg` / `panel_azimuth_deg` | 90 / 0 | ทิศทางของแผง |
| `panel_area_m2` / `panel_efficiency` | 2.0 / 0.28 | แผงโซลาร์ |
| `battery_capacity_wh` | 2000 | ความจุแบตเตอรี่ |
| `base_power_w` / `heater_power_w` | 40 / 60 | โหลดพื้นฐานและโหลดฮีตเตอร์ |
| `depth_of_discharge` | 0.8 | สัดส่วนความจุแบตเตอรี่ที่ใช้ได้จริง |
| `darkness_hours` | จากข้อมูลจุดลงจอด | ระยะเวลาที่มืดซึ่งต้องวางแผนรองรับ |

ตัวอย่าง:

```bash
curl "http://localhost:8000/api/site-analysis/malapert-massif?panel_area_m2=4&battery_capacity_wh=8000"
```

## สูตรฟิสิกส์ (`backend/physics.py`)

- **พลังงานแสงอาทิตย์**: `P = S · A · η · max(0, ŝ·n̂) · V` โดย S = 1361 W/m²
- **การอยู่รอดของแบตเตอรี่**: `t = (C · DoD) / (P_base + P_heater)`
- **ME → ENU**: เมทริกซ์หมุนที่มีแถวเป็น East, North, Up ณ (lat, lon)
- **การมองเห็นดวงอาทิตย์**: สัดส่วนพื้นที่ส่วนโค้งของดวงอาทิตย์ที่อยู่เหนือขอบฟ้าราบ (รัศมีดวงอาทิตย์ 0.267°)
- **ความชัน / TRI**: `slope = atan(|∇z|)`; TRI (Riley 1999) = √Σ(zᵢ − z₀)² บนพื้นที่ข้างเคียง 3×3

## ข้อควรระวังเกี่ยวกับข้อมูล

- พิกัดของพื้นที่ Artemis III เป็น**จุดศูนย์กลางโดยประมาณ** พื้นที่จริงแต่ละแห่งมีขนาดประมาณ 15×15 กม.
- ค่า `sunlight_pct`, `dte_pct` และ `max_darkness_hours` ของพื้นที่ขั้วใต้เป็น**ค่าประมาณเพื่อการสาธิต** ควรแทนที่ด้วยข้อมูลแสงอาทิตย์และ DTE จาก LOLA ก่อนนำไปวิเคราะห์จริง
- โปรไฟล์พลังงานใน API ใช้**ขอบฟ้าราบ** บริเวณใกล้ขั้วภูมิประเทศมีผลต่อแสงมาก จึงควรใช้พารามิเตอร์ `terrain_visibility` ประกอบ

## การเพิ่ม/แก้ไขคำแปล

- ข้อความบนหน้าเว็บอยู่ในออบเจกต์ `I18N` ใน `frontend/app.js` (คีย์ `en` และ `th`)
- ข้อมูลจุดลงจอดใน `sites_data.json` มีฟิลด์ `status_th` และ `description_th` สำหรับภาษาไทย ถ้าไม่มีจะแสดงภาษาอังกฤษแทน
