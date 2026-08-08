DMO Toolbox Ultimate V19 — Mobile / PWA / Performance

V19 รวม V18 ไว้แล้ว ใช้ไฟล์ V19 อย่างเดียวได้

อัปเกรดจาก V17/V18:
1. สำรอง Google Sheet เดิม
2. วาง GoogleAppsScript.gs V19 แทนตัวเดิม
3. Deploy > Manage deployments > Edit > New version > Update
4. ใช้ URL /exec เดิม
5. อัปไฟล์ V19 ทั้งโฟลเดอร์ขึ้น Netlify (ต้องมี manifest.webmanifest, sw.js และ icon ทั้งสองไฟล์)
6. เปิดเว็บแล้ว Ctrl+Shift+R หนึ่งครั้ง
7. เข้า Admin > Automation เพื่อสร้าง Backup และเปิด Auto Backup

บนมือถือเมื่อเว็บอยู่ HTTPS เบราว์เซอร์ที่รองรับจะแสดงปุ่ม “ติดตั้ง” เมื่อเข้าเงื่อนไข PWA
