# ฐานข้อมูล PostgreSQL ของ PawInn

PawInn ใช้ PostgreSQL หนึ่งคอนเทนเนอร์และหนึ่งฐานข้อมูลชื่อ `pawinn` ตามค่าเริ่มต้น Account ดูแลผู้ใช้และสัตว์ Room ดูแลประเภทห้อง ห้องจริง และช่วงปิด Booking ดูแลการจอง คำขอเปลี่ยนแปลง ประวัติ และข้อมูลการดูแล บริการเชื่อมผ่าน `postgres:5432` ภายใน Compose

ตั้ง `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` และ `JWT_SECRET` ตาม [ขั้นตอนใน README](../README.md) ตอนสร้าง volume ครั้งแรก `init.sql` จะสร้างตารางและเพิ่มห้อง 15 ห้อง หากตั้ง `PAWINN_SEED_DEMO=true` จะโหลดบัญชี สัตว์ การจอง และกรณีทดสอบเวลาเพิ่มด้วย ดูรายละเอียดใน [ตารางข้อมูลตัวอย่าง](../README.md#booking-time-fixtures)

## ตรวจฐานข้อมูลที่กำลังรัน

รันจากโฟลเดอร์ PawInn ภายใน Course Container เพื่อเปิด `psql` โดยใช้ค่าบัญชีฐานข้อมูลของคอนเทนเนอร์

```sh
docker compose -p pawinn exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## ใช้ข้อมูลเดิม

สคริปต์ตั้งต้นรันเมื่อ volume ว่างครั้งแรกเท่านั้น เมื่อเปิดระบบรุ่นใหม่ บริการจะปรับโครงสร้างที่จำเป็นบน volume เดิม ประวัติจองและเวลาที่บันทึกจริงจะยังอยู่ ใช้ค่าชื่อฐานข้อมูล ผู้ใช้ และรหัสผ่านชุดเดิม การแก้รหัสผ่านใน `.env` อย่างเดียวไม่ได้เปลี่ยนรหัสผ่านใน PostgreSQL ที่สร้างแล้ว

หากเคยเปิด demo seed และจะเปลี่ยนมาใช้งานโดยปิด seed ให้รันคำสั่งนี้เพื่อปล่อยห้องที่ยังถูกจองโดยรายการตัวอย่าง สคริปต์เก็บแถวประวัติและบันทึกการเปลี่ยนสถานะ

```sh
docker compose -p pawinn exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/booking/retire-fixtures.sql'
```

## ทดสอบแบบแยกฐานข้อมูล

`sh scripts/verify.sh` สร้างฐานข้อมูลชั่วคราวชื่อ `pawinn_test` พร้อม demo seed ทดสอบความเป็นเจ้าของสัตว์ ความถูกต้องของราคา การจองทับช่วง และการคงข้อมูลหลังรีสตาร์ต ดู [คำสั่งและขอบเขตการทดสอบ](../tests/README.md)
