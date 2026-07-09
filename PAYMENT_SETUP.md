# RushPoint — הגדרת מערכת תשלומים ישראלית

> **מדוע לא Stripe?**  
> Stripe אינה מספקת שירות סליקה לעסקים הרשומים רשמית בישראל. ניתן לפתוח חשבון עם כתובת אמריקאית, אך זה מהווה הפרת תנאי שירות וסיכון לסגירת החשבון ועיכוב כספים. בנוסף, פרדיאסקל ישראלי מאפשר פשוט יותר לקבל תשלומים בשקלים ולהתממשק עם מע"מ וחשבוניות ישראליות.

---

## ספקי סליקה מומלצים לישראל

### ✅ המלצה ראשונה: Cardcom (קארדקום)

**אתר:** https://cardcom.solutions  
**מתאים ל-RushPoint כי:**
- API מפותח — דומה לחווית עבודה עם Stripe (Hosted Page + Webhooks)
- תמיכה בחיוב חוזר / עמידה (Recurring / Standing Order) — נדרש ל-Creator Pro
- Tokenization — שמירת טוקן לחיוב עתידי ללא פרטי כרטיס
- PCI-DSS Level 1 Compliant
- ותיק ומוכח — משמש אלפי עסקי SaaS ישראלים
- תמיכה בחשבוניות אוטומטיות (ניתן לחבר עם iCount / חשבשבת)

**עלויות משוערות:**
- עמלת עסקה: ~1.4%–2.2% לפי נפח
- דמי הקמה: ~300–500 ₪ (חד-פעמי)
- דמי חודשיים: ~150–250 ₪

---

### ✅ חלופה: Tranzila (טרנזילה)

**אתר:** https://www.tranzila.com  
- API דומה, ותיק ואמין
- פחות מסמכים להקמה
- פחות תכונות subscription-native (צריך לבנות לוגיקה בצד שרת)

---

### ✅ חלופה קלה יותר להקמה: Meshulam (מְשוּלָּם)

**אתר:** https://meshulam.co.il  
- ממשק web פשוט + API
- הקמה מהירה יחסית (שעות לא ימים)
- מתאים לשלב ראשון לפני נפח גדול
- פחות בשל לסצנות subscription מורכבות

---

## שלבי הקמה — Cardcom (ראשוניים)

### שלב 1: פתיחת חשבון

1. היכנס ל-https://cardcom.solutions/contact
2. מלא בקשה לחשבון עסקי
3. הכן את המסמכים הבאים:
   - תעודת עוסק מורשה / עוסק פטור **או** רישום חברה (תיק עוסק)
   - תעודת זהות של מורשה החתימה
   - פרטי חשבון בנק עסקי לזיכוי
   - תיאור קצר של הפעילות (פלטפורמת SaaS למשחקי שטח)
4. זמן אישור: 3–7 ימי עסקים

### שלב 2: קבלת פרטי גישה לAPI

לאחר אישור, Cardcom מספקת:
```
TerminalNumber=XXXXXXX      # מספר טרמינל ייחודי
UserName=XXXXX              # שם משתמש API
Password=XXXXX              # סיסמת API
```

### שלב 3: הגדרת Webhook

בממשק Cardcom → הגדרות → URL הודעות:  
```
https://us-central1-rushpoint-pwa-7daaa.cloudfunctions.net/paymentWebhook
```

### שלב 4: עדכון קובץ `functions/.env`

```env
# Cardcom
CARDCOM_TERMINAL=XXXXXXX
CARDCOM_USERNAME=XXXXX
CARDCOM_PASSWORD=XXXXX
APP_URL=https://rushpoint-creator.web.app
```

---

## שינויי קוד נדרשים ב-`functions/src/payments/index.ts`

המערכת הנוכחית בנויה ל-Stripe. להמרה ל-Cardcom/Tranzila:

### עקרון פעולה (זהה לStripe)

```
יוצר לוחץ "רכוש קרדיטים"
→ הפונקציה purchaseCredits יוצרת Transaction URL ב-Cardcom
→ יוצר מנותב לדף תשלום מאובטח של Cardcom (Hosted Page)
→ לאחר תשלום, Cardcom שולח Webhook לפונקציה paymentWebhook
→ הפונקציה מזכה את הארנק
```

### API endpoint של Cardcom ליצירת עסקה

```
POST https://secure.cardcom.solutions/api/v11/LowProfile/Create
Content-Type: application/json

{
  "TerminalNumber": "{{CARDCOM_TERMINAL}}",
  "UserName": "{{CARDCOM_USERNAME}}",
  "APILevel": 10,
  "codepage": 65001,
  "OperationResponse": "https://{{APP_URL}}/payment-success",
  "OperationResponseError": "https://{{APP_URL}}/payment-cancel",
  "Language": "HE",
  "Coin": 1,
  "Sum": 179,
  "ProductName": "Event Credits - Standard",
  "InvoiceHead": {
    "CustName": "{{userName}}",
    "SendByEmail": true,
    "Language": "HE",
    "Email": "{{userEmail}}"
  }
}
```

**Response:**
```json
{
  "ResponseCode": 0,
  "Description": "OK",
  "url": "https://secure.cardcom.solutions/ExternalPaymentPage.aspx?code=XXXXXXXX",
  "LowProfileCode": "XXXXXXXX"
}
```

### מבנה Webhook מ-Cardcom

```
POST /paymentWebhook

Body (x-www-form-urlencoded):
  low_profile_code=XXXXXXXX
  ReturnValue=XXXXXXXX       // הערך שהגדרת (uid + packageId)
  Response=0                  // 0 = הצלחה
  terminalnumber=XXXXXXX
  dealId=XXXXXXXX
  sum=179
```

### מה צריך לשנות בקוד

**`functions/package.json`** — הוסף:
```json
"node-fetch": "^3.3.2"
```

**`functions/src/payments/index.ts`** — עיקרי השינויים:

1. **הסר** את `import Stripe from 'stripe'` ואת כל קוד Stripe
2. **הוסף** פונקציית עזר `createCardcomTransaction(sum, productName, returnValue, userEmail, userName)` שמבצעת `fetch` ל-Cardcom API ומחזירה URL
3. **עדכן** `purchaseCredits` — במקום `stripe.checkout.sessions.create` → `createCardcomTransaction`
4. **עדכן** `subscribePro` — עבור הפקודה החוזרת (Creator Pro), Cardcom מספק `StandingOrder` endpoint; אם זה מורכב מדי בשלב ראשון, ניתן לטפל ב-Pro כ**עסקה חד-פעמית שנתית** ולחדש ידנית
5. **שנה** את `stripeWebhook` → `paymentWebhook` (onRequest) ובדוק `Response === '0'` + אמת ש-`low_profile_code` לא עובד שוב (idempotency)
6. **עדכן** ב-`functions/src/index.ts`: `export { paymentWebhook }` במקום `stripeWebhook`

---

## Tranzila — חלופה פשוטה יותר

אם Cardcom מסורבל, Tranzila עובד בצורה דומה:

```
POST https://secure5.tranzila.com/cgi-bin/tranzila71u.cgi

Params:
  supplier=XXXXX
  TranzilaPW=XXXXX
  sum=179
  currency=1          # 1 = שקל
  tranmode=A          # Authorize + Capture
  response_return_path=https://{{APP_URL}}/payment-success
```

---

## Creator Pro — אפשרות ביניים (מנוי שנתי ידני)

עד להטמעת מנוי אוטומטי (Standing Order), ניתן להשיק את Creator Pro כ:
1. עסקה חד-פעמית שנתית (990 ₪ / שנה)
2. במחזור החידוש — לשלוח למשתמש מייל ידני לחידוש, עם קישור תשלום חדש
3. כאשר הנפח מצדיק זאת, לעבור ל-Standing Order ב-Cardcom

---

## כתובת דוא"ל לפניות תשלום

לכל שאלה לגבי חיוב, ניתוב לכתובת: **spendora.tracker@gmail.com**

---

## סדר פעולות מומלץ

```
1. פתח חשבון Cardcom (או Tranzila)          → 3-7 ימי עסקים
2. קבל פרטי API
3. עדכן functions/.env
4. עדכן functions/src/payments/index.ts
5. בדוק בסביבת test (Cardcom מספקת terminal נפרד לtest)
6. Deploy ל-production
7. בצע עסקת test אמיתית של 1 ₪
8. ודא שהארנק זוכה בFirebase
```
