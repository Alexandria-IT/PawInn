# สถาปัตยกรรม PawInn

เบราว์เซอร์รับหน้า HTML, Tailwind CSS และ Alpine.js จาก Nginx และเรียก API ผ่านที่อยู่เดียวกัน Nginx ส่งคำขอไปยังบริการ Express ตามเส้นทาง

| เส้นทาง | บริการ | หน้าที่ |
| --- | --- | --- |
| `/api/auth`, `/api/users`, `/api/pets` | Account | จัดการบัญชี การเข้าสู่ระบบ และโปรไฟล์สัตว์ |
| `/api/room-types`, `/api/rooms` | Room | จัดการประเภทห้อง ห้องจริง และช่วงปิด |
| `/api/availability`, `/api/bookings`, `/api/cancellations` | Booking | ตรวจห้องว่าง จัดการการจอง ชำระเงินจำลอง รับส่งสัตว์ และบันทึกการดูแล |

บริการทั้งสามใช้ PostgreSQL ฐานเดียวกันผ่านเครือข่าย Docker Compose ตารางมี Foreign Key เชื่อมข้อมูลบัญชี สัตว์ ห้อง และการจอง ทีมจึงต้องประสานกันเมื่อแก้ตารางที่ใช้ร่วมกัน ส่วนข้อมูลอยู่ใน Docker volume เพื่อให้ใช้งานต่อได้หลังสร้างคอนเทนเนอร์ใหม่

Account ออก Bearer token ที่มีวันหมดอายุ บริการตรวจลายเซ็นและตรวจบทบาท สถานะบัญชี และรุ่นของเซสชันจาก PostgreSQL คำขออ่านโปรไฟล์สัตว์ ประวัติจอง และรูปจำกัดตามสิทธิ์ของบัญชี การสร้าง Staff ใช้คำสั่งจาก Account container ตาม [README](../README.md#set-up-staff-access)

Booking เลือกห้องจริงและคำนวณราคาในธุรกรรมเดียว การจองและการเปลี่ยนสถานะห้องใช้ PostgreSQL advisory lock ร่วมกัน และฐานข้อมูลปฏิเสธการจองห้องหรือสัตว์ซ้อนด้วย exclusion constraints หน้าเว็บที่รองรับจะรับสัญญาณ SSE จาก Booking เพื่อโหลดข้อมูลใหม่ ส่วนการชำระเงินและคืนเงินเป็นรายการจำลองที่บันทึกพร้อมประวัติ

## การส่งมอบและตรวจสอบ

GitHub Actions กับ Jenkins ใช้ `sh scripts/verify.sh` ตรวจระบบใน Compose project ชั่วคราว Jenkins ติดแท็กอิมเมจตาม commit ใช้อิมเมจชุดที่ผ่านการทดสอบ deploy ลง project `pawinn` ตามค่าเริ่มต้น และตรวจหน้า **Our rooms** กับ API ประเภทห้องหลัง deploy

[วิธีเปิด Jenkins สำหรับเดโม](../README.md#run-jenkins-in-docker) ใช้ไฟล์ `.env` ร่วมกับ PawInn ถ้าตั้ง Jenkins เอง สามารถใส่ไฟล์ตั้งค่าผ่าน Secret file credential ชื่อ `pawinn-env` ซึ่งมีลำดับก่อนค่าจากไฟล์ใน Jenkins container ก่อนเปลี่ยนคอนเทนเนอร์ Jenkins จะตรวจว่าค่าที่ใช้ deploy เชื่อมกับฐานข้อมูลเดิมได้

PawInn เปิดบนพอร์ต 8080 และ Jenkins เปิดบนพอร์ต 8081 ภายใน Course Container ตามค่าเริ่มต้น ผู้ใช้เปิดจากเครื่องผ่าน SSH forwarding ที่ 8082 และ 8083 ตามลำดับ Compose จะเริ่ม frontend หลังบริการ API พร้อมรับคำขอ ระหว่างสร้าง frontend ใหม่ พอร์ตเว็บอาจหยุดตอบชั่วคราวจนบริการพร้อม

ดู [แผนภาพระบบ](../README.md#system-architecture) และ [คู่มือตรวจงานใน Course Container](local-demo.md)
