# ฟิสิกส์ LineSim — 12 พฤศจิกายน 2026

เปลี่ยน Plant ทั้งชุดที่ใช้ร่วมกันในรอบจำลอง, auto tune, ARecord/AReplay และการสร้างเส้นทางจาก log ไม่ได้แก้เฉพาะคะแนนจูน ค่าอ้างอิงของผู้ใช้ใช้ตรวจพฤติกรรมหลังเปลี่ยน ไม่ได้ใช้หา CG/แรงมอเตอร์ด้วยการปรับจนผ่าน

## สมการและสิ่งที่เปลี่ยน

- กลศาสตร์คำนวณหน่วย SI; แปลงตำแหน่ง/เซนเซอร์เป็นซม. ที่ขอบเขตแสดงผล คาบ PID/กลศาสตร์ 5 ms
- มอเตอร์ DC: `F = Fstall * (duty * load * mismatch - vWheel / vNoLoad)` เมื่อมีคำสั่ง พร้อม dead zone และ latency คำสั่งศูนย์ปล่อยไหล; คำสั่งกลับขั้วให้แรงต้าน/กลับทาง ใช้ความเร็วสัมผัสล้อซ้าย/ขวาจากความเร็วตัวหุ่นกับอัตราหมุน
- ถอด speed lag แยกการเร่ง/เลี้ยว `tauc/tau` ออก ความเร็วเกิดจากแรง/มวล อัตราหมุนเกิดจากแรงบิด/ความเฉื่อย `load` เปลี่ยนความหมายเป็นสัดส่วนแรงดันใช้งาน ไม่ใช่ตัวคูณความเร็วหลังคำนวณแรง
- น้ำหนักกดหน้า `Nfront = clamp((W * cgForward - mass * ax * cgHeight) / support, 0, W)` และหลัง `W - Nfront` ใช้ความเร่งสเต็ปก่อนสำหรับการถ่ายน้ำหนัก; พัดลมสมมติให้แรงลงที่ CG
- ล้อขับหลังแต่ละข้างมีวงแรงเสียดทานเดียว: `Fx² + Fy² ≤ (mu * Nwheel)²` แรงที่ใช้เร่งเหลือให้ตามโค้งน้อยลง แบ่งแรงด้านข้างตามส่วนของวงแรงที่ยังเหลือ ไม่มีโควตา μg สองชุด การแบ่งน้ำหนักซ้าย/ขวายังสมมาตร ไม่จำลอง roll
- คำนวณความเร็ว CG ในพิกัดโลก แก้ impulse ด้านข้างที่จุดสัมผัสเพลาหลังด้วยมวลและความเฉื่อยร่วมกัน (`1/m + cgForward²/Iyaw`) จึงได้ทั้งการไถลและผลต่อการหมุน ไม่ใช้กฎให้ทิศความเร็วไล่ตามหัวหุ่นด้วยอัตราคงที่
- ล้อขับแต่ละข้างเป็นตัวแปรสถานะ (ความเร็วสัมผัสล้อ) มีความเฉื่อยสะท้อน `wheelInertia` (โรเตอร์×อัตราทด²+ล้อ, ตั้งต้น 1.8e-6 kg·m² ต่อข้าง เทียบเท่ามวล J/r²) back-EMF คิดจากความเร็วล้อ แรงยางมาจาก slip (ความเร็วล้อ − ความเร็วจุดสัมผัส) ด้วยความแข็ง `tyreStiff` (ตั้งต้น 60 N ต่อ m/s) แล้วอิ่มตัวที่วงแรงเสียดทาน ล้อจึงหมุนฟรี/ล็อกได้ ไม่ถูกตรึงกับตัวหุ่น; Plant ย่อย 5 ครั้ง (1 ms) ต่อคาบควบคุม 5 ms ใช้ implicit กับความเร็วล้อ ค่า `wheelInertia`/`tyreStiff` เป็นสมมติฐานที่ยังไม่ได้วัด และเลื่อนขอบความเสถียรของ Kp สูง (ดูตารางความไวด้านล่าง)
- แรงต้านการกลิ้งต้านการเคลื่อนที่ และจำกัดไม่ให้ดันหุ่นที่หยุดอยู่กลับทาง
- หน้ายกเกิดจากโมเมนต์แรงเร่งกับน้ำหนัก รอบเพลาหลัง รวมความเฉื่อย pitch; กลับลงด้วยแรงโน้มถ่วงและ contact constraint ไม่มี `aLift`/`liftMs` หรือการดับเซนเซอร์ค้างด้วย timer ใช้ขอบเขต pitch สูงสุด 1.4 rad; ไม่จำลองพลิกคว่ำ/กระแทกละเอียด
- ตำแหน่งรับแสงหดตาม cos(pitch), ความสูงแต่ละตัวเพิ่มตาม SF*sin(pitch) และสัญญาณลดแบบ `exp(-(height/sensorRange)²)` จึงคืนสัญญาณตามความสูงจริงในโมเดล ไม่เติม noise

แรงมอเตอร์/มวล/ความเฉื่อยอ้างโครงสร้างสมการของ [WPILib physics simulation](https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/physics-sim.html); ข้อจำกัดแรงเสียดทานตามแรงกดอ้าง [OpenStax: Friction](https://openstax.org/books/university-physics-volume-1/pages/6-2-friction) ส่วนการจัดสรรวงแรง, contact impulse, pitch และการลดแสงเป็นการประมาณเฉพาะของ LineSim ไม่ใช่การนำ simulator ทั้งตัวจากแหล่งเหล่านี้มาใช้

## สิ่งที่รู้และค่าที่ต้องวัด

| รายการ | หลักฐาน/สมมติฐาน |
|---|---|
| PID/AccelSet | ตรวจซอร์ส Pro; weighted position 0–1500, รอบแรกใช้ elapsed time ตั้งต้น 500 ms ตาม examples, รอบต่อไป 5 ms; ไม่จำลอง jitter หรือ PID state ก่อนเข้าแต่ละคำสั่ง |
| รูปทรง/ตำแหน่งเซนเซอร์ | ตัวหุ่น 15×15 ซม., ล้อ 23 มม., ระยะล้อ 12 ซม., SF/SX จากไฟล์แผง 16MuxV3 |
| มวล | ตั้งต้น 0.2 kg; เปลี่ยนได้ |
| CG/ความเฉื่อย | CG หน้าจากเพลา 3 ซม., สูง 2 ซม., Iyaw=0.00075 kg·m² เป็นค่าตั้งต้นเชิงรูปทรง ไม่ใช่ผลวัดหุ่นผู้ใช้; support สมมติที่ขอบหน้า 13.85 ซม. |
| มอเตอร์ | คง preset N60 6000 rpm/10 A/ทด1:5 และ N20 ตัวอย่างจากเดิม ไม่ได้มี datasheet ยืนยัน motor curve ของหุ่นผู้ใช้; load=.46/bias=.091 เป็นค่าเดิมที่ยังต้องเทียบความเร็วและกระแสจริง |
| ยาง/พัดลม | μ=1/1.5/2/3 เป็นระดับประมาณ ไม่ใช่ค่าจากการทดสอบยาง; downforce เริ่ม 0 N เพราะยังไม่มีค่าที่วัด |
| เซนเซอร์ | footprint ห้าจุดรัศมี .4 ซม., cutoff หลังปัดค่า <6, sensorRange .5 ซม. เป็นแบบจำลองแสง; ไม่จำลองแสงแวดล้อม/ADC noise |
| ขอบเขต | รถบนพื้นราบ ไม่จำลองวงจรแบต sag, อุณหภูมิ, caster swivel, roll/โหลดซ้ายขวา, หรือการพลิกคว่ำครบ 3 มิติ |
| log จริง | เส้นทางที่ reconstruct จากตำแหน่งเซนเซอร์เป็นเส้นทางอนุมานด้วยโมเดลเดียวกัน ห้ามใช้เป็น ground truth อิสระรับรองฟิสิกส์ |

## อ้างอิงของผู้ใช้และการตรวจ

ผู้ใช้ระบุว่านิ่งผ่านโค้งช่วง 4/ตรงช่วง 5 ซ้ายล่าง Formula:

- `ATrack(100, 0.08, 0, 0.0040, -255, 0, 3500)`
- `ATrack(80, 0.08, 0, 0.0024, -255, 0, 4500)`

หลังเปลี่ยนโมเดล ทดสอบ Formula μ=3, AccelSet(.17,80), startWaitMs=500: แต่ละชุดจบเส้นทางครบ 12/12 จุดเริ่มโดยไม่มีช่วงเซนเซอร์ไม่เห็นเส้น และช่วงคำสั่งจากจุดเริ่มสนามครบ 3.5/4.5 วินาที ไม่ออกนอกเส้นทาง ข้อนี้เป็น regression เชิงพฤติกรรม ไม่ใช่การยืนยันเวลา/ตำแหน่งจริงตรงกัน เพราะไม่มี trajectory/timestamp/สภาพเริ่มของสองรันจริง

โมเดลใหม่ไม่ได้บังคับให้ปิด accel หรือใช้ dt แรกผิดแล้วต้องหลุดเสมอ จึงเปลี่ยน regression เดิมที่ล็อกให้ความผิดพลาดนั้นต้องทำหุ่นหลุด เป็นการตรวจค่าตัวเลข PID รอบแรกและผลที่ accel เปลี่ยน trajectory โดยตรง

`npm run test:physics` ตรวจหยุดนิ่ง, วิ่งตรง/ถอย, สมมาตรซ้ายขวา, coast/กลับขั้ว, มวล/ความเฉื่อย, grip ไม่เปลี่ยนรอบปลาย, วงแรงร่วม, น้ำหนักกดรวม, หน้ายกแล้วลง, พัดลมเพิ่ม traction และสัญญาณแสงลดตามความสูง ตรวจเพิ่มว่าปล่อยไหลระหว่างเลี้ยวไม่เพิ่มพลังงาน และลดสเต็ป 5→2.5 ms ให้ตำแหน่งหลังเลี้ยว 1 วิแตกต่างประมาณ .077 ซม. ตรวจ record/replay ที่ความเร็วเล่นเท่ากับบันทึกได้ครบเส้นทาง; ไม่รับประกันการเล่นเต็ม255จะผ่าน เพราะอาจไถลหรือหน้ายกตามพารามิเตอร์หุ่น ร่วมกับ `test:firmware-timing`, `test:accel`, auto tune/cache/grip, CPU workers และ GPU parity

ยังไม่มีการทดสอบขับหุ่นจริงหรือยืนยันความคลาดเคลื่อนเชิงปริมาณของฟิสิกส์ครบชุดจากข้อมูลวัด

## ความไวของขอบความเสถียร (Formula μ3, speed80, Kd.0024, Ki0, slow0; สคริปต์ชั่วคราว ไม่ใช่การปรับให้ผ่าน)

ref Kp .08 และ .15/.2 จบรอบไม่หลุดทุกชุดค่าที่ลอง (wheelInertia 0/1.8e-6/5e-6 × tyreStiff 30/60/150) Kp .3 ผ่านเมื่อ wheelInertia ≥1.8e-6 แต่หลุดเมื่อ 0; Kp .46 หลุดทุกชุด (เร็วสุด ~4 s เมื่อ wheelInertia 0 ช้าสุด ~32 s) ดังนั้นการที่ Kp สูงไม่เสถียรเป็นผลของแรงยางตาม slip + ความหน่วงมอเตอร์ แต่ตำแหน่งขอบแน่นอนขึ้นกับค่าสมมติฐานสองตัวนี้ ต้องวัดหรือเทียบกับหุ่นจริง (Kp สูงหุ่นจริงสั่นที่ ~5 Hz หรือไม่)

## Latency, ระยะเผื่อ และเกณฑ์ความนิ่งของ Best (12 พ.ย. 2026 ค่ำ)

- latency คำสั่งมอเตอร์ตั้งต้น 12 ms ละเอียด 1 ms (เดิม 10 ms ทีละ 5 ms) ค่า 12 ms เลือกจากการสแกนบน Formula μ1.5 speed80: ref (Kp .08 Kd .0024) นิ่งทุกค่า, Kp .46 Kd .005 ส่ายต่อเนื่องแต่ยังจบรอบที่ ≤12 ms และเริ่มหลุดเส้นที่ 13 ms ตรงกับที่ผู้ใช้เห็นบนหุ่นจริง นี่เป็นการฟิตขอบความเสถียรจากข้อสังเกตเดียว ไม่ใช่ค่าที่วัด
- การจูน (Best/Max) จำลองด้วย latency +4 ms (`tuneTrial`) เป็นระยะเผื่อ
- Best (ไม่ใช่ Max): `runBestSearch` รัน ref ของผู้ใช้ (speed ที่เลือก, Kp .08, Kd .0024) บนสนาม/ยาง/ฟิสิกส์เดียวกัน วัด `osc` (จำนวนครั้ง err พลิกเครื่องหมายบนช่วงตรง hysteresis ±10 ต่อวินาที ไม่นับวินาทีแรก) ตั้ง `oscLimit = max(1.3×ref, ref+0.5)` คะแนน += 8×max(0, osc−oscLimit)
- ผล Best Formula μ1.5 speed80: Kp .3 Kd .009, 12/12, 20.77 s, osc 1.43 (ref 1.48)
- ข้อสังเกต: log จริง 1.3 วินาที (`REAL_POS`) ให้ RMS 37.6 (ก่อนล้อสถานะ), 55.4 (ล้อสถานะ latency 10) ฟิตด้วย latency 0 ได้ ~20 แต่ขัดกับการส่ายของ Kp .46 จริง จึงยังไม่ใช้

## Best = ไม่แย่กว่า ref แล้วเลือกที่นุ่มที่สุด (12 พ.ย. 2026 ดึก; แทนที่การลงโทษ osc แบบน้ำหนักข้างบน)

- คะแนนแบบถ่วงน้ำหนักไม่ทำให้ ref ชนะ (grid บน Formula μ1.5 speed80: Kp สูงให้เวลา/โค้งดีกว่าเสมอ) จึงเปลี่ยนการเลือกผลสุดท้ายของ Best (ไม่ใช่ Max)
- `runBestSearch` รัน ref (Kp .08, Kd .0024) ที่ speed/สนาม/ยางเดียวกัน (ใช้ระยะเผื่อ latency +4 ms เหมือนผู้สมัครอื่น) ถ้า ref ผ่าน 12/12: ผู้สมัครที่ "ไม่แย่กว่า ref" คือ ผ่าน 12/12, ไม่หลุดเส้น/หลุดในโค้ง, เวลารอบ ≤ ref, curve RMS ≤ ref, เวลานอกแนว 2 ซม. ≤ ref, osc ≤ max(1.3×ref, ref+0.5) ในกลุ่มนั้นเลือกค่า `slew` (ผลรวม |Δ steering output| ต่อสเต็ป) ต่ำสุด ถ้ายังไม่มีผู้สมัครผ่าน/ ref ไม่ผ่านที่ speed นั้น ใช้คะแนนเดิม
- ref ถูกเพิ่มเข้า shortlist เสมอ
- ผล: Formula speed80 μ1.5 และ μ3 ได้ Kp .08 Kd .0024; speed 100/120 ได้ Kp ~.29–.3 (ref ไม่ผ่านที่ความเร็วนั้น)
- ยังไม่ได้ลองบนหุ่นจริง

## ฟิตใหม่จาก log จริง (12 พ.ย. 2026 ดึก; แทนที่ latency 12 ms และข้อ "Best = ref" ด้านบนซึ่งถอนแล้ว)

- ถอนกฎให้ Best เลือก ref แล้ว (สำรอง `.backups/index-with-ref-select-20261112.html`) Best กลับใช้คะแนน + เกณฑ์ osc ตามเดิม
- ฟิตพารามิเตอร์ Plant กับ log จริง `REAL_POS` (1.3 s, speed 90 Kp .3 Kd .009): lat 2 ms, tyreStiff 150, wheelInertia 1.8e-6 คงเดิม ความต่างตำแหน่ง RMS 55.4 → 23.8 (peak −581@870 ms เทียบจริง −602@855 ms)
- dead zone ของมอเตอร์ทำให้ log เข้าแย่ลง (RMS ~150) และรอบช้า 25–35 s จึงไม่ใช้ load คงเดิม .46
- พฤติกรรมที่สอดคล้องข้อสังเกตหุ่นจริง (Formula μ1.5 speed80): ref osc ~1.1; Kp .3 osc ~1.1–1.3; Kp .46 Kd .005 osc 4–6 ยังจบรอบ
- Best Formula μ1.5 speed80 ตอนนี้: Kp .345 Kd .0072 ยังไม่ได้ลองบนหุ่นจริง ฟิตนี้ใช้ log สั้นชุดเดียวบนสนามที่ถอดรูปจากโมเดลเอง ไม่ใช่การ calibrate เต็ม

## ปรับตามเวลารอบจริง 12 วินาที (12 พ.ย. 2026 ดึกมาก)

- ข้อมูลจริงจากผู้ใช้: `ARecord(80, 0.08, 0, 0.0024, -255, 0, 12000)` ครบรอบ Formula ประมาณ 12 วินาที (โมเดลเดิมได้ 21 วินาที) จึงตั้ง `load` 0.46 → 0.8: ref ที่ speed 80 ได้ 12.2 s ไม่หลุดเส้น, log จริง `REAL_POS` ยังเข้า (RMS 23.1), `loadReal` 0.8 ด้วย (หมุนรวมของ U ที่ −180° สอดคล้องกับ load สูงขึ้น) load ≥0.9 แม้ ref ก็หลุด
- ยางตั้งต้น μ 2 (ตัวเลือกที่ 3) เพราะที่ load 0.8 ref ตัวที่สอง (speed 100 Kp .08 Kd .004) ออกตัวจากหยุดนิ่งแล้วหลุดเมื่อ μ 1.5 แต่ผ่านที่ μ ≥2 (หลุดเซนเซอร์ช่วงสั้น ~0.15 s)
- ที่ load 0.8 สนาม Senior ไปได้เฉพาะ gain ต่ำและ speed ≤ ~45–50 (Kp ≥ .12 หลุด) เทสต์ที่เคยใช้ speed 90 บน Senior ถูกปรับเป็นพารามิเตอร์ที่เป็นไปได้ (physics RR: Kp .1 Kd .004 speed 40; objective baseline: [.1,.004,0,45]; grip: Senior speed 45; accel/firmware-timing: ผ่อน lostTime ของ speed 100 เป็น <0.5 s)
- ลองสเกลแรงบิดมอเตอร์ (จำกัดกระแส) แล้วทำให้ทุกอย่างแย่ลง จึงถอนออก
- ref ในโมเดลตอนนี้: curve RMS 2.68 cm, นอกแนว 2 ซม. ~4.7 s ต่อรอบ, ออกนอกเส้นกลางสูงสุด 6 cm ผู้ใช้บอกว่าของจริงหลุดโค้งน้อยกว่านี้ (ยังไม่ได้ปรับ)

## Best เผื่อ lag เท่าที่ ref ทนได้ (12 พ.ย. 2026 ดึกมาก)

- หุ่นจริงส่ายที่ Kp .46 (Kd .005 และ .0096) แต่ในโมเดล gain สูงนี้ยังเสถียร แปลว่าหุ่นจริงมี lag ที่โมเดลไม่มี
- `runBestSearch` (ไม่ใช่ Max) หา "lag เพิ่ม" สูงสุด (ทีละ 4 ms, 8–28) ที่ ref (Kp .08, Kd .0024) ยังผ่าน 12/12 แล้วใช้ค่านั้นเป็น `sv.latMargin` ให้ `tuneTrial` (Max ใช้ 4 ms เหมือนเดิม) ผู้สมัครทุกค่าและตัวชี้วัด osc ของ ref ถูกวัดที่ lag นั้น
- บน Formula speed80 μ2: ref ทนได้ถึง lag เพิ่ม ~16 ms (Kp .3 หลุดที่ 16, Kp .46 หลุดที่ 12) Best ได้ Kp .13 Kd .006 (μ1.5: Kp .2875 Kd .008)
- ค่าความขัดแย้งที่ยังเหลือ: log จริง 1.3 s เข้ากับ μ1.5 (RMS ~23) ดีกว่า μ2 (~49) แต่ ref speed 100 จากหยุดนิ่งผ่านเฉพาะ μ ≥2

## Best ค้น Kd/Kp ในช่วง 0.001–0.1 (ประสบการณ์ผู้ใช้; 12 พ.ย. 2026 ดึกมาก)

- ผู้ใช้ระบุว่าอัตราส่วน Kd/Kp จากประสบการณ์อยู่ราว 0.001–0.1 (ref 0.03) Best (ไม่ใช่ Max) ค้น Kd = {0.001, 0.003, 0.01, 0.02, 0.03, 0.05, 0.1} × Kp ตอน refine ให้ Kd อยู่ในช่วงนี้เสมอ (ค่า P ปัจจุบันเข้ารายการเมื่ออยู่ในช่วง) Max ค้น Kd อิสระ
- Formula speed80: μ2 → Kp .13 Kd .0065; μ1.5 → Kp .255 Kd .009
- ผู้ใช้ยอมให้ส่ายเล็กน้อยตอนออกโค้งแลกเวลา: osc นับเฉพาะช่วงตรง (ไม่นับวินาทีแรก)
- โมเดลไม่มีสัญญาณรบกวนในอนุพันธ์ แต่เฟิร์มแวร์คำนวณอนุพันธ์จาก error ดิบ ไม่มีตัวกรอง และ dt เป็นจำนวนเต็ม ms จึงอาจทำให้ Kd สูงส่ายบนหุ่นจริงมากกว่าในโมเดล (ยังไม่ได้เพิ่ม รอผู้ใช้ตัดสินใจ)

## สรุปสถานะหลังข้อมูลหุ่นจริงหลายชุด (13 พ.ย. 2026)

ข้อมูลจริงจากผู้ใช้ (Formula, ยาง μ2, speed 80 เว้นแต่ระบุ): ref Kp .08 Kd .0024 วิ่ง ~12 s นิ่ง; Kp .08 Kd .0032 ดีกว่า ref; ค่าที่สั่น: (.13,.0065), (.46,.005), (.46,.0096), (.069,.0069 @ speed 52); ผู้ใช้ไม่ต้องการให้ใช้ ref speed 100 ตัดสินใจ

- ถอน dead zone ออก (dead 0, deadS 0; ทำให้ speed ต่ำช้าเกินจริง: speed 52 ได้ 22 s) กลับเป็น load/loadReal 0.8
- เพิ่มตัววัด `slew` (ค่าเฉลี่ย |Δ PID output| ต่อสเต็ป): ค่าจริงที่นิ่ง ≤ 1.54× ของ ref, ที่สั่น 1.95–4.1× Best (ไม่ใช่ Max) คิดคะแนนหนักเมื่อ slew > 1.5× ของ ref (วัดบนสนาม/ยาง/ความเร็วเดียวกัน)
- พารามิเตอร์ `posNoise` (ความสั่นของตำแหน่งเส้น, seed ต่อ trial) เพิ่มไว้แต่ปิด (0) เพราะเกณฑ์ slew แยกกลุ่มได้โดยไม่ต้องมี noise
- Best ยังมี: Kd/Kp 0.001–0.1, ผ่อนเกณฑ์ lag ตาม ref, gain margin ×1.15/1.3/1.45, และผ่อนเกณฑ์เป็นขั้น (tier 1/2) เมื่อไม่พบ
- ผล Best Formula μ2: speed80 Kp .092 Kd .004; speed90 .1/.0036/slow .025; speed100 .184/.00384/slow .05; speed120 .034/.0008/slow .2; speed150 ผ่อนเกณฑ์ .034/.0032/slow .2
- ยังไม่ได้ลองค่าเหล่านี้บนหุ่นจริง (ยกเว้น .08/.0032 ที่ผู้ใช้ทดสอบแล้วดีกว่า ref)

## ปิด gain margin, เพดาน slew 1.3× (13 พ.ย. 2026)

- ผู้ใช้ทดสอบจริงว่า Kp .08 Kd .0032 ดีกว่า (เร็วกว่าและนิ่งกว่า) ref และดีกว่าค่าที่ Best ให้ (.092/.004/slow .05)
- ใน sim .08/.0032 ได้คะแนน 14.30 (slew 1.24× ref) ดีกว่า .092/.004/.05 (14.54; slowrage ทำให้รอบ 13.4 s) แต่ Best ตัดทิ้งเพราะ gain margin ×1.15/1.3/1.45 จึงปิด gain margin (`GMS = []`; ใช้เกณฑ์ lag-margin + osc + slew ≤1.3× ref แทน)
- Best Formula μ2 speed80 ตอนนี้ Kp .092 Kd .0032 slow .025; speed90 .1/.0036/.05; speed100 .184/.0032/.05; speed120 .034/.0008/.2; speed150 .034/.0032/.2

## Max ใช้เกณฑ์ชุดเดียวกับ Best (13 พ.ย. 2026)

- `runBestSearch` (Max) วัด ref (Kp .08 Kd .0024) ที่ทุก speed 30–250 (ก้าว 10) เก็บ `sv.yard[speed] = {margin (lag เพิ่ม 4/8/12/16 ms ที่ ref ยังผ่านครบ), oscLimit, slew}` ถ้า ref ไม่ผ่านที่ speed นั้นใช้ค่าของ speed สูงสุดที่ผ่าน `tuneTrial` ใช้ margin ต่อ speed, `evaluateTune` หักคะแนนเมื่อ osc/slew เกินเกณฑ์ (slew > 1.3× ref) เหมือน Best
- Max Formula μ2: speed 100 Kp .184 Kd .0024 slowrage .1 (เดิม Kp .46 Kd .0096 ซึ่งผู้ใช้เจอว่าหุ่นจริงสั่น) ใช้เวลาคำนวณเพิ่ม ~10 s
- Best: slowrage 0 เสมอยกเว้นขั้นผ่อนเกณฑ์สุดท้าย (tier 2), Kd/Kp 0.001–0.1 (ตารางอัตราส่วนละเอียดขึ้น), ปิด gain margin, ผ่อนเกณฑ์เป็นขั้น
- เทสต์: objective ให้คะแนน baseline ด้วยเกณฑ์เดียวกับที่การค้นหาใช้ (hook `options.onSetup`), workers ยอมหลายชุด worker ต่อ Best (ปิดครบ)
- ผลจำลอง: ยิ่งเร็วช่วง gain ที่วิ่งจบแคบลง (Formula μ2: ที่ speed 100 เหลือ ~Kp .08, ที่ 110 ไม่มีค่าที่ผ่าน) จึงให้ Kp ลดลงตาม speed ยังไม่ได้เทียบกับหุ่นจริงที่ speed > 80
- ยังค้าง: Best ที่ speed ที่ ref ไม่ผ่าน (≥~110) ใช้ขั้นผ่อนเกณฑ์ที่เปิด slowrage, ตัวตรวจจับ record/replay (DET) แคบเกิน (รายละเอียดในแชท) รอผู้ใช้เลือกทาง A/B

## Record -> replay (2026-11-13, matches PulseMiniV2.2ControlPro.h 2.0.2)
- Defaults are the tuned real values: speed 90, Kp 0.15, Kd 0.003, AccelSet(0.17, 80), AReplay(0.75). Record -> replay keeps the manual tune when its record lap finishes the course; only if it fails the Best search is used.
- Detector: moving average of |error| (alpha 0.25 per 5 ms tick), bands 100 (in) / 180 (out), hold 30 ms enter / 150 ms exit.
- AccelSet keeps limiting during the whole replay (not only the launch); lowering the command is immediate.
- AReplay: position from distance travelled (estimated speed lags the command with 150 ms), snapped to the recorded curve entry/exit when the detector sees one within 300 ms; finishes at the recorded total distance. Straights run at 255 for the learned share of their length and brake (250 ms x speed above the recorded speed) before the curve.
- Learning: every straight starts at 100 % (capped by AReplay ratio). A lap that sees a curve while still fast, or loses the line in the straight or the curve after it, lowers that straight by 10 % and locks it. The UI replays the lap until it passes twice (up to 12 laps) and shows the learned shares.
- Not modelled: PWM frequency (3.9 kHz) and motor heating; the real robot reaches full speed on the first straight without lifting the sensors at AccelSet 0.17 (user's real run).
- Backups of the previous version: `.backups/index-before-final-replay-20261113.html` (+ README / MODEL_NOTES).

## Recalibration after the motor PWM change (2026-11-13)
- Real run: ARecord(90, 0.15, 0, 0.003, -255, 0, 9800) laps Formula in about 9.7 s, faster than the model (11.1 s at tyre mu 2, load 0.8), because the motor PWM was raised from 490 Hz to 3.9 kHz. Defaults are now tyre level 4 (mu 3) and motor load 0.9: the same command gives a 9.74 s lap and the record lap finishes. Other fitting combinations exist (mu 3 with lat 6 and load 0.9 gives 9.66 s); this one changes only the two existing parameters. The earlier mu 2 / load 0.8 calibration (speed 80 lap about 12 s) belongs to the old PWM.
- The record lap now ends at TotalTime (P.recMs, default 9800, 0 = until the course is finished) like ARecord(). It counts as complete when the sensor row reached 96 % of the route.
- Fixtures of test:physics, test:firmware-timing and test:objective keep the earlier calibration explicitly (mu 2, load 0.8, TotalTime unlimited) so they still test the same mechanics.
- Steadiness (2026-11-13, later): at control latency 12 ms and yaw inertia 0.00075 the straights of the record lap wobbled (error std 10-108 units, up to one sensor spacing) while the real robot is steady with no line loss. Defaults are now lat 2 ms and yaw inertia 0.0004 (straight error std 3-29 units), with motor load 0.89 so the lap stays 9.68 s. Earlier fits (lat 12) belong to the old 490 Hz PWM. tests/physics, firmware-timing and objective set lat 12 / yaw 0.00075 / mu 2 / load 0.8 explicitly to keep their baselines.
