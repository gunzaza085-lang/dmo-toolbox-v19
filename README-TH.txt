GUN SHOP DMO V20.1 — STABILITY & SECURITY FINAL
================================================
เจ้าของร้าน: Natthananat Kawinwatthanakorn

ระบบยังใช้ Architecture เดิม:
- HTML / CSS / Vanilla JavaScript
- GitHub Pages / PWA
- Google Apps Script
- Google Sheets / Google Drive

ไม่มีขั้นตอน npm, build, Docker หรือฐานข้อมูลภายนอก

ก่อนเปิดใช้งานจริง
-------------------
1) สำรอง Google Sheet ตัวจริงก่อนทุกครั้ง
2) ใช้ไฟล์ฐานข้อมูล 3.1.0 กับสำเนาทดสอบก่อน ห้ามเขียนทับข้อมูลร้านทันที
3) นำ GoogleAppsScript.gs ไปแทนโค้ดใน Apps Script ของสำเนาทดสอบ
4) Run ฟังก์ชัน menuInitialize หนึ่งครั้งและอนุญาตสิทธิ์ที่ Google ขอ
5) รีโหลด Google Sheet แล้วเลือกเมนู GUN SHOP DMO > ตั้ง/รีเซ็ตรหัส OWNER
6) ตั้ง User ID และรหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร ห้ามใช้รหัสเดิมของ V20
7) Deploy > New deployment > Web app
8) Execute as: เจ้าของ Script
9) Who has access: ค่าที่ทำให้หน้าร้านเรียก createOrder ได้ตามนโยบายบัญชี Google ของคุณ
10) คัดลอก URL ที่ลงท้าย /exec ไปใส่ใน config.js หาก URL เปลี่ยน

ทดสอบก่อน Production
---------------------
- ใช้สำเนา Google Sheet แยกจากร้านจริง
- สร้างสินค้าทดสอบที่มี Stock
- ทดสอบ NEW > CHECKING > PREPARING > READY
- ติ๊ก OrderItems ให้ครบก่อน COMPLETED
- ตรวจว่า COMPLETED ตัด Stock และ Reserved เพียงครั้งเดียว
- ทดสอบ CANCELLED จากสถานะก่อนเสร็จและตรวจว่า Reserved ถูกคืน
- กดส่งคำขอเดิมซ้ำและตรวจว่าไม่เกิดออเดอร์ซ้ำ
- เปิด Admin > ตรวจข้อมูล และต้องไม่มี Error
- ทดสอบ OWNER, ADMIN, STAFF และ VIEWER

GitHub Pages
------------
1) อัปโหลดไฟล์เว็บทั้งหมดไว้ที่ root ของ repository
2) ห้ามอัปโหลดไฟล์ที่มี secret หรือข้อมูลลูกค้าจริง
3) Settings > Pages > Deploy from a branch > main > /(root)
4) เปิดเว็บแบบ Incognito เพื่อตรวจ public API
5) ตรวจว่า browser ไม่ได้รับ costPrice, apiKey, note หรือ reservedStock
6) หากเห็นไฟล์เก่า ให้ Hard Refresh หรือถอน Service Worker/cache เดิม

ข้อมูลสำคัญ
-----------
- ราคาและยอดออเดอร์จริงคำนวณที่ Google Apps Script เท่านั้น
- totalSpent ของลูกค้าหมายถึงยอดจากออเดอร์ COMPLETED เท่านั้น
- CANCELLED และ COMPLETED เป็นสถานะปลายทาง เปลี่ยนย้อนกลับไม่ได้
- Integrity Checker รายงานอย่างเดียว ไม่แก้หรือลบข้อมูล
- ห้ามแชร์ Apps Script editor, Google Sheet, session token หรือรหัส Admin

ดูรายละเอียดเพิ่ม:
- MIGRATION-V20.1-TH.txt
- SECURITY-V20.1-TH.txt
- TEST-REPORT.txt

