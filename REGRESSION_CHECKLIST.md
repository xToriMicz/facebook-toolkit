# Regression Checklist — facebook-toolkit

ตรวจทุกข้อก่อน merge PR เข้า main

## Automated (preflight.sh)

รัน `./scripts/preflight.sh` — ตรวจอัตโนมัติ:

- [x] Branch = main
- [x] HTML build จาก components สำเร็จ
- [x] JS syntax ถูกต้องทุกไฟล์
- [x] Worker build สำเร็จ
- [x] Components ถูก include ครบ
- [x] ไม่มี dead element references
- [x] ไม่มี secrets ในโค้ด
- [x] **Tab integrity** — ทุก tab ใน HTML อยู่ใน router.js

## Manual Smoke Test

ตรวจด้วยตา + กดจริงบนเว็บ:

### Sidebar Navigation
- [ ] กดทุกปุ่มใน sidebar → tab ที่ถูกต้องเปิดขึ้น
- [ ] tab ก่อนหน้าหายไป (ไม่แสดงซ้อน)
- [ ] sidebar highlight ตรงกับ tab ที่เปิด

### Page Select
- [ ] เปลี่ยนเพจ → tab ที่เปิดอยู่ reload data ใหม่
- [ ] ทุก tab ที่ใช้ selectedPage แสดงข้อมูลเพจที่เลือก

### Tab-specific
- [ ] เขียนโพส: compose + preview + post ทำงาน
- [ ] ประวัติ: โหลดโพส + engagement chart
- [ ] ปฏิทิน: แสดงเดือน + โพส
- [ ] ตั้งเวลา/Bulk: schedule list + bulk drafts
- [ ] Activity Log: filter + search
- [ ] คอมเม้น: auto-reply settings + ประวัติจัดกลุ่ม 2 ชั้น
- [ ] คอมเม้นเพจอื่น: เพิ่มเพจ + ประวัติ
- [ ] เทรนด์: โหลดสินค้า
- [ ] Insights: stats + chart + top posts
- [ ] Challenge: แสดง challenges
- [ ] ตั้งค่า AI: provider + model
- [ ] แจ้งบัค: ส่ง ticket + ดู list

### Console
- [ ] ไม่มี JS error ใน browser console
- [ ] ไม่มี failed network requests (ยกเว้น 401 ถ้าไม่ login)

### Build
- [ ] `npm run build` สำเร็จ
- [ ] `./scripts/preflight.sh` ผ่านทุกข้อ
