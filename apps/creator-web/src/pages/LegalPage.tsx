import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderInline } from './legalMarkdown';

type DocType = 'privacy' | 'terms';

// ---------------------------------------------------------------------------
// Document content — Hebrew + English
// ---------------------------------------------------------------------------

const SECTIONS = {
  privacy: {
    he: {
      title: 'מדיניות פרטיות',
      updated: 'עודכן לאחרונה: יוני 2026',
      body: `
## 1. מבוא ותחולה

RushPoint ("החברה", "אנחנו", "אנו") מפעילה פלטפורמת SaaS ליצירה והפעלה של משחקי שדה בעולם האמיתי בכתובת rushpoint.app ("השירות"). מדיניות פרטיות זו ("המדיניות") מסבירה אילו נתונים אנו אוספים, כיצד אנו מעבדים אותם, עם מי אנו משתפים אותם, וכיצד ניתן לממש את זכויותיך כנושא מידע.

מדיניות זו מיושמת בהתאם לחוק הגנת הפרטיות, תשמ"א-1981 ("חוק הפרטיות"), תקנות הגנת הפרטיות (אבטחת מידע), תשע"ז-2017, וחוק התקשורת (בזק ושידורים), תשמ"ב-1982 בכל הנוגע לדיוור ישיר.

בשימוש בשירות, אתה מסכים לאיסוף ועיבוד המידע כמתואר כאן. אם אינך מסכים, אנא הימנע משימוש בשירות.

## 2. הגדרות

**"יוצר"**: כל מי שרשם חשבון ב-RushPoint ויוצר ו/או מפעיל משחקים.
**"משתתף"**: כל אחד שמצטרף למשחק שנוצר ע"י יוצר.
**"ריצה"**: אירוע משחק מתוזמן בזמן אמת שבו משתתפים מתחרים.
**"נתוני מיקום"**: קואורדינטות GPS ו/או רשת שנאספות מהמכשיר.
**"מידע אישי"**: כל מידע המזהה או שעלול לזהות אדם ספציפי.

## 3. מידע שאנו אוספים

### 3.1 מידע שנמסר ע"י יוצרים

בעת ההרשמה ובשימוש השוטף אנו מקבלים:
- שם מלא וכתובת דואר אלקטרוני
- פרטי חשבון Google אם נרשמת דרך Google Sign-In
- תוכן משחקים שיצרת: שמות שלבים, תיאורי משימות, תמונות שהעלית, מיקומים גיאוגרפיים של תחנות
- מסרים ששלחת אלינו דרך ערוצי התמיכה

### 3.2 מידע שנמסר ע"י משתתפים

משתתפים נכנסים לשירות באמצעות אימות אנונימי (ללא רישום). אנו אוספים:
- מזהה משתמש אנונימי ייחודי (אינו מקושר לשם אמיתי)
- שם הצוות שנבחר בעת ההצטרפות
- נתוני ביצועים: ניקוד, זמנים, תשובות שנמסרו
- פרטים שהוזנו בשדות מותאמים (ראה סעיף 3.5)

### 3.3 מיקום GPS: גילוי מלא

**חשיבות: איסוף מיקום הוא תכונת ליבה של השירות.**

אנו אוספים נתוני מיקום GPS מהמכשיר של המשתתף **בזמן ריצה פעילה בלבד**, למטרות הבאות:
- **ניתוב:** חישוב המשימה הבאה המתאימה ביותר בהתאם למיקום המשתתף
- **גיאופנס:** אימות אוטומטי כי הצוות הגיע פיזית לתחנה הנדרשת
- **מפת חי:** הצגת מיקום הצוותות ביחס זה לזה על גבי מפה בזמן אמת לעיני יוצר המשחק ו/או צוות השטח שלו

**מה שאנו לא עושים עם נתוני המיקום:**
- לא אוספים מיקום לפני תחילת הריצה או לאחר סיומה
- לא מוכרים נתוני מיקום לצדדים שלישיים
- לא משתמשים בנתוני מיקום לפרסום ממוקד
- לא מבצעים עיבוד נוסף מעבר לצרכי הניתוב ואימות הגיאופנס

נתוני מיקום גולמיים נשמרים 90 יום מסיום הריצה ואז נמחקים אוטומטית.

**הסכמה:** שימוש בפיצ'ר הניתוב דורש מתן הרשאת מיקום במכשיר. ניתן לסרב; הריצה תמשיך, אך חלק מהמשימות (גיאופנס) לא יוכלו לאשר נוכחות אוטומטית.

### 3.4 תמונות שמועלות במהלך משחק

כחלק ממשימות מסוג "תמונה", משתתפים רשאים (ומוזמנים) להעלות תמונות:
- התמונות מאוחסנות ב-Firebase Storage תחת פרויקט הענן שלנו
- הן גלויות ליוצר המשחק ולצוות השטח שלו לצרכי בדיקת המשימה
- אנו לא מפרסמים תמונות משתתפים לצד שלישי ולא משתמשים בהן לצרכי שיווק
- תמונות נמחקות 90 יום לאחר סיום הריצה, אלא אם היוצר ביקש מחיקה מוקדמת יותר

**יוצר המשחק אחראי בלעדי** לכל שימוש שהוא עושה בתמונות שנאספו ולהבטחה שאיסוף תמונות במשחק שלו עומד בדרישות חוק הפרטיות.

### 3.5 שדות רישום מותאמים אישית של יוצרים

יוצרים רשאים להוסיף שדות מותאמים לתהליך הצטרפות המשתתפים למשחק. שדות אלו עשויים לכלול, לפי שיקול דעת היוצר:
- שמות פרטיים ומשפחה
- מספרי טלפון
- גיל ו/או תאריך לידה
- מגבלות גופניות, מגבלות תזונה, נגישות
- פרטי איש קשר לשעת חירום
- כל שדה אחר שהיוצר הגדיר

**הבחנה חשובה:** RushPoint מספקת את התשתית הטכנית לאיסוף שדות אלו אך **אינה קובעת את תוכנם ואינה אחראית** על שימוש יוצרים בנתונים שנאספו. יוצרים שאוספים מידע בשדות מותאמים נושאים בעצמם את כל האחריות לציות לחוק הפרטיות, לרבות חובת ההגנה על אותו מידע ומחיקתו לפי הצורך.

בהצטרפות למשחק עם שדות מותאמים, המשתתף מסכים שהמידע שמסר יועבר ליוצר האירוע.

### 3.6 מידע טכני ונתוני שימוש

- כתובות IP ונתוני גישה בסיסיים (נדרשים לאבטחה ולניפוי שגיאות)
- סוג מכשיר, מערכת הפעלה, גרסת דפדפן
- נתוני ביצועים אנונימיים (זמני תגובה, שגיאות)
- מספר משחקים, ריצות, ומשתתפים לכל חשבון יוצר

## 4. מטרות עיבוד המידע

אנו מעבדים מידע אישי למטרות הבאות בלבד:

- **הפעלת השירות:** אימות משתמשים, ניתוב, ניהול ריצות וניקוד
- **תמיכה טכנית:** אבחון בעיות, מענה לפניות תמיכה
- **ציות לחוק:** תגובה לצווי בית משפט, הוראות רגולטוריות, ומניעת הונאה
- **שיפור השירות:** ניתוח אנונימי של דפוסי שימוש (ללא זיהוי אישי)
- **תקשורת שירותית:** הודעות על שינויים מהותיים בשירות

אנו **לא** מבצעים פרופיילינג אוטומטי לצרכי פרסום ולא מכינים פרופיל שיווקי על בסיס פעילות המשתמש.

## 5. העברת מידע לצדדים שלישיים

אנו **לא מוכרים ולא משכירים** מידע אישי. אנו משתפים מידע עם:

**Google LLC / Firebase**: ספק תשתית הענן שלנו. Firebase Auth, Firestore, ו-Cloud Storage פועלים בשרתי Google. Google מחויבת ל-GDPR ולמסגרות Privacy Shield. Privacy Policy: policies.google.com/privacy.

**ספק הסליקה המאושר**: עיבוד תשלומי האשראי. פרטי כרטיס אשראי אינם עוברים דרך שרתינו ואינם מאוחסנים בבסיסי הנתונים שלנו. ספק הסליקה מקבל רק את הנתונים הנחוצים לאישור העסקה.

**MapTiler AG**: ספק אריחי המפה. MapTiler מקבל בקשות אריחים סטנדרטיות ואינו מקבל נתוני מיקום של משתתפים ספציפיים.

**יוצרי המשחקים**: יוצר שמפעיל ריצה רואה את המיקום הנוכחי של הצוותות (בזמן ריצה בלבד), ניקוד, תשובות, ותמונות שהועלו. הוא גם רואה נתונים שמשתתפים מסרו בשדות מותאמים. ראה סעיף 3.5.

**רשויות:** נמסור מידע לרשויות אכיפת חוק אך ורק בהתאם לחובה חוקית מפורשת או צו שיפוטי בר-תוקף.

## 6. אבטחת מידע

אנו מיישמים אמצעי אבטחה בהתאם לתקנות הגנת הפרטיות (אבטחת מידע), תשע"ז-2017 ("תקנות האבטחה"), ובכלל:

- **הצפנה בהעברה (TLS 1.2+):** כל תקשורת בין הדפדפן לשרת מוצפנת
- **הצפנה באחסון:** Firebase Storage ו-Firestore מצפינים נתונים at-rest
- **גישה מבוססת תפקידים:** עובדים ו/או קבלנים של החברה ניגשים לנתונים רק בהיקף הנדרש לתפקידם
- **כללי Firestore:** כתיבה לנתוני ריצות, ניקוד ומיקום מותרת לשרת בלבד; לקוחות מקבלים קריאה מוגבלת
- **אימות דו-שלבי:** מומלץ לכל חשבוני יוצר

בתרחיש של דלף מידע שעלול לפגוע בנושא מידע, נודיע לנפגעים ולרשות הגנת הפרטיות בהתאם לדרישות החוק.

## 7. שמירת מידע ומחיקה

**תקופות שמירת מידע:**
- נתוני חשבון יוצר: כל עוד החשבון פעיל; 30 יום לאחר בקשת מחיקה
- נתוני מיקום GPS גולמיים: נמחקים אוטומטית 90 יום מסיום הריצה
- תמונות שהועלו: נמחקות אוטומטית 90 יום מסיום הריצה
- תוצאות מצטברות (ניקוד ודירוג): נשמרות כל עוד החשבון פעיל; נמחקות עם מחיקת החשבון
- שדות מותאמים: נמחקים עם מחיקת החשבון או הריצה
- נתוני שימוש אנונימיים: עד 24 חודשים

**בקשת מחיקה:** יוצרים יכולים לבקש מחיקת חשבון וכל הנתונים הקשורים אליו על-ידי פנייה ל-privacy@rushpoint.app. ביצוע המחיקה תוך 30 יום.

## 8. זכויות נושא המידע

מכוח חוק הגנת הפרטיות, תשמ"א-1981, עומדות לך הזכויות הבאות:

**עיון (סעיף 13 לחוק):** זכות לקבל עותק של המידע האישי שנשמר עליך.

**תיקון (סעיף 14):** זכות לבקש תיקון מידע שגוי, חלקי, או מטעה.

**מחיקה:** זכות לבקש מחיקת חשבונך וכל הנתונים הקשורים אליו, בכפוף לאי-קיום חובות חוקיות המחייבות שמירת המידע.

**התנגדות לשיווק:** זכות להתנגד לקבלת מסרים שיווקיים בכל עת.

**ניידות נתונים:** לבקשה, נספק ייצוא של המידע שלך בפורמט מובנה.

לממש זכויות אלה: **privacy@rushpoint.app** · spendora.tracker@gmail.com

## 9. עוגיות ועקיבה

אנו משתמשים **בעוגיות חיוניות בלבד:**
- עוגיות אימות Firebase (נדרשות לשמירת המצב המחובר)
- העדפות שפה (HE/EN)

אין שימוש בעוגיות מעקב, ניתוח פרסומי, ריטרגטינג, ו/או פיקסלים של רשתות פרסום.

## 10. מסרים שיווקיים ותקשורת

בהתאם לחוק התקשורת (בזק ושידורים), תשמ"ב-1982 (תיקון מס' 40, "חוק הספאם"), לא נשלח דיוור שיווקי ללא הסכמה מפורשת. הסכמה לדיוור שיווקי היא בחירה נפרדת מהסכמה לתנאי השימוש. ניתן לבטל הסכמה זו בכל עת דרך קישור הסרה בכל הודעה.

## 11. ילדים ובני נוער

השירות מיועד לאנשים מגיל 16 ומעלה. אנו לא אוספים ביודעין מידע אישי ממשתמשים מתחת לגיל 16. אם נודע לנו שנאסף מידע כזה, נמחק אותו לאלתר. הורה ו/או אפוטרופוס המודע לרישום קטין מתחת לגיל 16 מוזמן לפנות אלינו.

## 12. העברות מידע בינלאומיות

נתוני המשתמשים מאוחסנים בשרתי Google Cloud Platform ועשויים לעבור עיבוד בשרתים מחוץ לישראל. Google מחויבת למנגנוני הגנה מחמירים (SCCs) התואמים דרישות הגנת הפרטיות הישראליות.

## 13. שינויים במדיניות

במקרה של שינויים מהותיים, נודיע בהודעה בתוך הפלטפורמה לפחות 14 יום לפני כניסתם לתוקף. המשך שימוש לאחר מועד הכניסה לתוקף מהווה הסכמה לשינויים.

## 14. יצירת קשר

לכל שאלה, בקשה לעיון, תיקון, ו/או מחיקה:

**דוא"ל:** privacy@rushpoint.app · spendora.tracker@gmail.com
**נושא הפנייה:** יש לציין "פנייה לפי חוק הפרטיות"

החברה תשיב לפניות בתוך 30 יום.
      `,
    },
    en: {
      title: 'Privacy Policy',
      updated: 'Last updated: June 2026',
      body: `
## 1. Introduction and Scope

RushPoint ("the Company", "we", "us") operates a SaaS platform for building and running real-world field games at rushpoint.app ("the Service"). This Privacy Policy explains what data we collect, how we process it, with whom we share it, and how to exercise your rights as a data subject.

This Policy is applied in accordance with Israel's Protection of Privacy Law, 5741-1981, the Privacy Protection Regulations (Data Security) 5777-2017, and the Communications Law (Telecommunications and Broadcasts) 5742-1982 regarding direct marketing.

By using the Service, you agree to the collection and processing of data as described here.

## 2. Definitions

**"Creator"**: any person who has registered an account and creates and/or runs games.
**"Participant"**: any person who joins a game created by a Creator.
**"Run"**: a scheduled, real-time game event in which participants compete.
**"Location Data"**: GPS and/or network coordinates collected from the device.
**"Personal Data"**: any information that identifies or could identify a specific individual.

## 3. Information We Collect

### 3.1 Information Provided by Creators

At registration and during ongoing use:
- Full name and email address
- Google account details if registered via Google Sign-In
- Game content you create: stage names, task descriptions, uploaded images, geographic station coordinates
- Messages sent to us via support channels

### 3.2 Information Provided by Participants

Participants access the Service via anonymous authentication (no registration required). We collect:
- A unique anonymous user ID (not linked to a real name)
- The team name chosen at sign-in
- Performance data: score, times, submitted answers
- Details entered in custom registration fields (see Section 3.5)

### 3.3 GPS Location Data: Full Disclosure

**Important: location collection is a core feature of the Service.**

We collect GPS location data from the participant's device **during an active run only**, for:
- **Routing:** calculating the best next task based on the participant's location
- **Geofencing:** automatically confirming that a team has physically arrived at a required station
- **Live map:** showing team locations to the Creator and their designated staff during the run

**What we do NOT do with location data:**
- We do not collect location before a run starts or after it ends
- We do not sell location data to any third party
- We do not use location data for targeted advertising
- We perform no additional processing beyond routing and geofence validation

Raw location data is retained for 90 days after run completion, then automatically deleted.

**Consent:** the routing feature requires granting location permission on the device. You may refuse; the run will continue, but geofence tasks cannot auto-confirm your presence.

### 3.4 Photos Uploaded During a Game

As part of photo-type tasks, participants may upload images:
- Photos are stored in Firebase Storage under our cloud project
- They are visible to the game's Creator and their designated staff for task review
- We do not publish participant photos to third parties or use them for marketing
- Photos are deleted 90 days after run completion

**The Creator is solely responsible** for any use they make of collected photos and for ensuring that photo collection in their game complies with the Protection of Privacy Law.

### 3.5 Creator-Customized Registration Fields

Creators may add custom fields to their game's participant join flow. These fields may include, at the Creator's discretion:
- First and last names
- Phone numbers
- Age and/or date of birth
- Physical limitations, dietary restrictions, accessibility needs
- Emergency contact details
- Any other field the Creator defines

**Important distinction:** RushPoint provides the technical infrastructure to collect these fields but **does not determine their content and is not responsible** for Creators' use of the collected data. Creators who collect information via custom fields bear full responsibility for compliance with the Protection of Privacy Law, including safeguarding that data and deleting it as required.

By joining a game that includes custom fields, the participant consents to the Creator receiving that data.

### 3.6 Technical and Usage Data

- IP addresses and basic access data (required for security and debugging)
- Device type, operating system, browser version
- Anonymous performance data (response times, errors)
- Number of games, runs, and participants per Creator account

## 4. Purposes of Data Processing

We process personal data only for these purposes:

- **Service operation:** user authentication, routing, run management, and scoring
- **Technical support:** diagnosing issues, responding to support requests
- **Legal compliance:** responding to court orders, regulatory requirements, and fraud prevention
- **Service improvement:** anonymous analysis of usage patterns (no individual identification)
- **Service communications:** notices about material changes to the Service

We do **not** conduct automated profiling for advertising purposes or build marketing profiles based on user activity.

## 5. Sharing Data with Third Parties

We **do not sell or rent** personal data. We share data with:

**Google LLC / Firebase**: our cloud infrastructure provider. Firebase Auth, Firestore, and Cloud Storage run on Google's servers. Google is committed to GDPR and equivalent privacy frameworks. Privacy Policy: policies.google.com/privacy.

**Authorized Payment Processor**: credit card payment processing. Card details do not pass through our servers and are not stored in our databases. The payment processor receives only the data necessary to approve the transaction.

**MapTiler AG**: map tiles provider. MapTiler receives standard tile requests and does not receive individual participant location data.

**Game Creators**: a Creator who runs a game can see current team locations (during the run only), scores, submitted answers, uploaded photos, and data entered in custom fields. See Section 3.5.

**Authorities:** we will disclose data to law enforcement only when required by an explicit legal obligation or a valid court order.

## 6. Data Security

We implement security measures in accordance with the Israeli Privacy Protection Regulations (Data Security) 5777-2017, including:

- **Encryption in transit (TLS 1.2+):** all browser-to-server communication is encrypted
- **Encryption at rest:** Firebase Storage and Firestore encrypt data at rest
- **Role-based access:** company employees and/or contractors access data only to the extent required for their role
- **Firestore security rules:** writing to run data, scores, and location is restricted to the server only; clients receive limited read access
- **Two-factor authentication:** recommended for all Creator accounts

In the event of a data breach likely to affect a data subject, we will notify those affected and the Privacy Authority as required by law.

## 7. Data Retention and Deletion

- Creator account data: retained while the account is active; 30 days after a deletion request
- Raw GPS location data: auto-deleted 90 days after run completion
- Uploaded photos: auto-deleted 90 days after run completion
- Aggregate results (scores and rankings): retained while the account is active; deleted when the account is deleted
- Custom field data: deleted when the account or run is deleted
- Anonymous usage data: up to 24 months

**Deletion request:** Creators can request deletion of their account and all associated data by contacting privacy@rushpoint.app. Deletion is carried out within 30 days.

## 8. Data Subject Rights

Under Israel's Protection of Privacy Law, 5741-1981, you have the following rights:

**Access (Section 13):** right to receive a copy of personal data stored about you.

**Correction (Section 14):** right to request correction of inaccurate, incomplete, or misleading data.

**Deletion:** right to request deletion of your account and all associated data, subject to any legal obligations requiring retention.

**Objection to marketing:** right to object to receiving marketing messages at any time.

**Data portability:** upon request, we will provide an export of your data in a structured format.

To exercise these rights: **privacy@rushpoint.app** · spendora.tracker@gmail.com

## 9. Cookies and Tracking

We use **essential cookies only:**
- Firebase authentication cookies (required to maintain the logged-in state)
- Language preferences (HE/EN)

No tracking cookies, advertising analytics, retargeting, or advertising network pixels are used.

## 10. Marketing Messages

In accordance with the Communications Law (Telecommunications and Broadcasts) Amendment No. 40, we will not send marketing messages without explicit consent. Consent to marketing is a separate choice from consent to these Terms. You may withdraw consent at any time via the unsubscribe link in any message.

## 11. Children and Minors

The Service is intended for users aged 16 and over. We do not knowingly collect personal data from users under 16. If we become aware that such data has been collected, we will delete it immediately. A parent or guardian who is aware of a minor under 16 having registered is invited to contact us.

## 12. International Data Transfers

User data is stored on Google Cloud Platform servers and may be processed on servers outside Israel. Google is committed to strict protection mechanisms (SCCs) compatible with Israeli privacy requirements.

## 13. Policy Changes

For material changes, we will notify users via an in-platform notice at least 14 days before the changes take effect. Continued use after the effective date constitutes acceptance of the changes.

## 14. Contact

For any question, access request, correction, or deletion request:

**Email:** privacy@rushpoint.app · spendora.tracker@gmail.com
**Subject:** please include "Privacy Rights Request"

The Company will respond to requests within 30 days.
      `,
    },
  },

  terms: {
    he: {
      title: 'תנאי שימוש',
      updated: 'עודכן לאחרונה: יוני 2026',
      body: `
## 1. כללי וקבלת התנאים

ברוך הבא ל-RushPoint. תנאי שימוש אלו ("התנאים") מסדירים את הגישה שלך לפלטפורמת RushPoint ואת השימוש בה. RushPoint ("החברה") מפעילה פלטפורמת SaaS ליצירה, השקה וניהול משחקי שדה בעולם האמיתי.

**בלחיצה על "יצירת חשבון", בכניסה למשחק, ו/או בכל שימוש אחר בשירות, אתה מצהיר שקראת, הבנת, ומסכים לתנאים אלו על כל חלקיהם.**

אם אינך מסכים, אנא אל תשתמש בשירות. גיל מינימלי: 16 שנה. אם אתה בין 16 ל-18, השימוש כפוף להסכמת הורה או אפוטרופוס.

## 2. הגדרות

**"יוצר"**: כל מי שרשם חשבון ויוצר ו/או מנהל משחקים.
**"משתתף"**: כל מי שמצטרף למשחק שנוצר ע"י יוצר.
**"ריצה"**: אירוע משחק בזמן אמת.
**"שירות"**: פלטפורמת RushPoint כולה, כולל הממשקים, ה-API, ו-Cloud Functions.
**"קרדיט אירוע"**: יחידת חיוב הנרכשת בתשלום ומשמשת להשקת ריצות.
**"Creator Pro"**: מנוי בתשלום הנותן יכולות מורחבות ליוצרים.
**"גלריה ציבורית"**: מאגר משימות ציבורי שיוצרים מפרסמים אליו ורשאים לשאול ממנו.

## 3. הרשמה ופרטי החשבון

- אתה מתחייב לספק פרטים נכונים ומדויקים בעת הרשמה.
- אתה אחראי לשמירת סודיות סיסמתך וכל פרטי הגישה לחשבונך.
- חל איסור להעביר חשבונות, לשתף גישה, ו/או ליצור חשבונות מרובים לעקוף מגבלות.
- עליך להודיע לנו לאלתר על כל חשד לשימוש לא מורשה בחשבונך.
- החברה שומרת לעצמה את הזכות לדרוש אימות זהות במקרים של חשד להפרת תנאים.

## 4. אופי השירות: פלטפורמת תוכנה בלבד

> RushPoint היא כלי תוכנה המספק תשתית טכנולוגית ליצירת ולניהול אירועים. החברה אינה מארגנת אירועים, אינה בוחרת מיקומים, אינה מספקת ציוד, ואינה נוכחת בשטח.

אנו מספקים:
- פלטפורמה לתכנון משחקים
- מנגנון השקה, ניהול, וניקוד בזמן אמת
- כלים לניהול צוותים ומשתתפים
- תשתית טכנית לאחסון ועיבוד נתונים

אנו **לא** מספקים:
- תכנון או אישור מסלולים
- הדרכות בטיחות
- ביטוח אחריות מקצועית
- פיקוח בשטח
- אחריות לתוכן, אסטרטגיה, ו/או החלטות שמתקבלות ע"י היוצר

## 5. תוכן שיוצרים מייצרים ורישיון הגלריה הציבורית

### 5.1 בעלות בתוכן

אתה שומר על זכויות היוצרים שלך בתוכן שיצרת, לרבות שמות משחקים, תיאורי שלבים, נוסח משימות, תמונות, ושאלות.

### 5.2 רישיון תפעול

בשימוש בשירות, אתה מעניק לחברה רישיון לא-בלעדי, חופשי מתמלוגים, ניתן להמחאה לצרכי תפעול, לאחסן, להציג, ולעבד תוכן זה לצורך מתן השירות. רישיון זה מסתיים עם מחיקת החשבון.

### 5.3 רישיון הגלריה הציבורית

בפרסום משימה לגלריה הציבורית של RushPoint, אתה מעניק לחברה ולכל משתמש אחר בפלטפורמה:

**רישיון לא-בלעדי, חופשי מתמלוגים, בלתי חוזר, ניתן לתת-רישוי, להעתיק, לשנות, לתרגם, ולשלב את המשימה במשחקים אחרים.**

רישיון זה:
- ניתן לשימוש על-ידי כל יוצר אחר בפלטפורמה, ללא צורך ביצירת קשר אתך
- מאפשר שינוי ועיבוד חופשי של המשימה המקורית
- לא מחייב ציון שם היוצר המקורי (attribution)
- אינו פוגע בזכות שלך להמשיך להשתמש במשימה ו/או להסיר אותה מהגלריה

**לאחר הסרת משימה מהגלריה:** יוצרים שכבר שאלו ו/או שילבו את המשימה במשחקיהם רשאים להמשיך להשתמש בה, אולם היא לא תהיה זמינה יותר לשאילה חדשה.

### 5.4 איסורים על תוכן

חל איסור **מוחלט** ליצור ו/או להעלות:
- תוכן פוגעני, גזעני, מאיים, מטריד, ו/או משפיל
- תוכן הפוגע בפרטיות של אנשים ספציפיים
- תוכן הפורץ זכויות יוצרים ו/או סימני מסחר של צדדים שלישיים
- תוכן המכוון משתתפים לאזורים מסוכנים, נכסים פרטיים ללא אישור, ו/או מתקנים מוגבלים
- תוכן הנוגד את הוראות כל דין ישראלי ו/או בינלאומי

## 6. אחריות יוצר המשחק ובטיחות גופנית של משתתפים

> **זהו הסעיף החשוב ביותר בתנאים. קרא בעיון.**

### 6.1 הצהרת אחריות מלאה של היוצר

יוצרי משחקים בפלטפורמת RushPoint הם **מארגני אירועים עצמאיים** בלבד. בהפעלת ריצה ואירוע, היוצר מצהיר, מאשר ומתחייב:

**(א) סיור שטח:** כי ביצע סיור מוקדם בכל המיקומים הכלולים במסלול המשחק, ווידא שהם פתוחים לציבור, בטוחים לכניסה, ומתאימים לסוג המשתתפים הצפויים.

**(ב) התאמת המסלול:** כי המסלול, הקצב, ורמת הדרישות הגופניות מתאימים לגיל, לכושר הגופני, ולמגבלות הרפואיות הידועות של משתתפיו.

**(ג) ציוד ומוכנות:** כי הדאיג לציוד בטיחות מתאים ו/או הנחה משתתפים מה לצייד בו עצמם.

**(ד) גישה לעזרה:** כי ידע למשתתפים כיצד לפנות לעזרה ראשונה ו/או שירותי חירום במהלך האירוע, וכי מספר חירום נגיש לכל הצוותות.

**(ה) היתרים וביטוח:** כי קיבל את כל ההיתרים הנדרשים לשימוש בשטחים ציבוריים ו/או פרטיים הכלולים במסלול, ובמידת הצורך, רכש ביטוח אחריות מקצועית לאירוע.

**(ו) ציות לחוק:** כי האירוע עומד בכל דרישות החוק הישראלי הרלוונטיות.

### 6.2 ויתור מוחלט על תביעות כנגד החברה

**בהפעלת אירוע דרך RushPoint, היוצר מוותר על כל עילת תביעה כנגד החברה, עובדיה, נושאי משרה בה, ובעלי מניותיה, בכל הנוגע לנזק גופני, נפשי, חומרי, ו/או כלכלי שנגרם למשתתפים, לצדדים שלישיים, ו/או ליוצר עצמו, כתוצאה ישירה ו/או עקיפה מתפעול האירוע.**

ויתור זה חל בין אם הנזק נגרם עקב:
- כישלון ציוד
- תנאי מזג אוויר
- נפילה, פציעה, ו/או תאונה בשטח
- כניסה למבנים ו/או אזורים לא בטוחים
- התנהגות משתתפים
- גורמים אחרים שמחוץ לשליטת החברה

**יודגש:** ויתור זה אינו גורע מאחריות החברה במקרים של מעשה מכוון ו/או רשלנות חמורה מצד החברה עצמה.

### 6.3 המלצות בטיחות מחמירות (אינן ממצות)

- **כתב ויתור:** החתם כל משתתף על כתב ויתור שנוסח ע"י עורך דין לפני תחילת האירוע
- **מספר חירום:** הספק לכל צוות מספר טלפון לחירום שאחד מאנשי הצוות יענה בו בכל עת
- **גבולות ברורים:** הגדר בכתב בפני המשתתפים אזורים אסורים ופעילויות אסורות
- **ניטור שוטף:** הישאר בקשר עם כל הצוותות לאורך האירוע
- **הזמינות רפואית:** ודא שיש גישה לציוד עזרה ראשונה ו/או לאיש צוות שהוכשר בעזרה ראשונה

**RushPoint אינה אחראית לנזק שנגרם בשל אי-יישום המלצות אלו.**

### 6.4 הצהרת משתתפים

בהצטרפות למשחק, כל משתתף מצהיר שהוא:
- מודע שמדובר בפעילות גופנית בשטח הכוללת הליכה ו/או ריצה
- לוקח אחריות אישית על כושרו הגופני ומתאמו לפעילות
- מסכים שהחברה אינה אחראית לנזקים גופניים הנובעים מהשתתפות

## 7. תשלומים, קרדיטים, ומנויים

### 7.1 ריצות חינמיות

כל חשבון חדש מקבל ריצות חינמיות לכל החיים עד 5 משתתפים כל אחת. ריצות חינמיות אינן ניתנות להמרה לכסף.

### 7.2 Event Credits: קרדיטי אירועים

- קרדיטים נרכשים בחבילות מוגדרות ומשמשים להשקת ריצות בתשלום
- קרדיטים שנרכשו אינם פגים
- עם השקת ריצה, הקרדיטים המתאימים מנוכים מהארנק **בשלב ההשקה** בלא אפשרות ביטול
- החזר כספי לקרדיטים שנרכשו ניתן אך ורק במקרה של תקלה טכנית מוכחת שמנעה לחלוטין את קיום הריצה, ובתנאי שהדיווח הוגש תוך 48 שעות מהמועד המתוכנן

### 7.3 Creator Pro: מנוי יוצר מקצועי

- Creator Pro הוא מנוי בתשלום שנתי ו/או חודשי
- ניתן לבטל בכל עת; הביטול ייכנס לתוקף בתום תקופת החיוב הנוכחית
- לא יינתן החזר יחסי על תקופה שנותרה לאחר ביטול
- שדרוג ממנוי חודשי לשנתי: ניתן בכל עת; ההפרש מחושב יחסית

### 7.4 כללי תשלום

- כל העסקאות מעובדות ע"י ספק הסליקה המאושר שלנו; פרטי כרטיס האשראי אינם מאוחסנים בשרתינו
- מחירים מוצגים בשקלים חדשים (₪) וכוללים מע"מ כנדרש בחוק הישראלי
- קבלות אלקטרוניות נשלחות לכתובת הדואר האלקטרוני של החשבון
- לשאלות חיוב: spendora.tracker@gmail.com

### 7.5 ריצה חינמית כבונוס הפניה

כל יוצר שמפנה יוצר חדש שנרשם ו/או יוצר שנרשם דרך קישור הפניה, יקבל ריצה חינמית נוספת. בונוס ההפניה מוגבל לריצה אחת לכל הפניה מוצלחת. החברה שומרת לעצמה את הזכות לשנות ו/או לבטל תוכנית ההפניות עם הודעה מוקדמת.

## 8. שימושים אסורים

חל איסור מוחלט להשתמש בשירות לצורך:
- ייצור תוכן בלתי חוקי, מסית, גזעני, ו/או פוגעני
- איסוף מידע אישי על משתתפים ללא הסכמתם המפורשת
- מעקב מיקום של אנשים ללא ידיעתם ו/או הסכמתם
- חדירה, ניסיון פרצה, ו/או עקיפת מנגנוני האבטחה של הפלטפורמה
- ריברס-אנג'ינירינג של קוד הפלטפורמה
- העמסת שרתים (DoS), בוטים, ו/או כל ניסיון לפגוע בזמינות השירות
- התחזות לגורמים אחרים
- שימוש בשירות לפעילות עסקית מתחרה ו/או לבנות מוצר דומה

## 9. הגבלת אחריות החברה

השירות ניתן "כמות שהוא" (AS IS) וכפי שזמין (AS AVAILABLE). ככל המותר בחוק הישראלי:

**(א) אין אחריות לתכנים:** החברה אינה אחראית לתוכן שנוצר ע"י יוצרים, לאמיתותו, לדיוקו, ו/או לחוקיותו.

**(ב) אין אחריות לנזקים עקיפים:** החברה לא תישא בנזקים עקיפים, תוצאתיים, מקריים, עונשיים, ו/או נזקים לאובדן הכנסות ו/או מוניטין.

**(ג) תקרת אחריות:** בכל מקרה, אחריות כוללת של החברה לא תעלה על הסכום שהתשלמת לחברה ב-12 החודשים שקדמו לאירוע הנזק.

**(ד) כוח עליון:** החברה לא תישא באחריות לאי-זמינות השירות ו/או לאובדן נתונים הנובעים מאירועים שמחוץ לשליטתה הסבירה.

**לעניין בטיחות גופנית:** ראה סעיף 6 לעיל.

## 10. שיפוי

אתה מתחייב לשפות ולהגן על החברה, עובדיה, נושאי משרה בה, ובעלי מניותיה מפני כל תביעה, נזק, הפסד, עלות, ו/או הוצאה (כולל שכר טרחת עורכי דין סבירים) הנובעים מ:
- הפרת תנאים אלו
- הפרת זכויות צדדים שלישיים
- תוכן שיצרת ו/או פרסמת
- אירוע שהפעלת, לרבות כל תביעת נזיקין ממשתתפים

## 11. קניין רוחני

הפלטפורמה עצמה, לרבות קוד המקור, עיצוב, אלגוריתמי הניתוב, ממשק המשתמש, ומסמכי מדיניות אלו, שייכת לחברה ומוגנת בזכויות יוצרים. אין להעתיק, לשכפל, ו/או להפיץ ללא אישור כתוב מהחברה. סימני המסחר של החברה לא ישמשו ללא אישור מוקדם.

## 12. השעיה וסיום חשבון

החברה שומרת לעצמה את הזכות להשהות ו/או לסגור חשבון:
- עם הודעה מוקדמת: בשל הפרות חוזרות ו/או ניצול לרעה של השירות
- ללא הודעה מוקדמת: בשל הפרות חמורות, תוכן לא חוקי, ו/או סיכון בטיחותי מיידי

עם סגירת חשבון, קרדיטים שנרכשו ייזכו יחסית, למעט מקרים שבהם הסגירה נובעת מהפרת תנאים.

## 13. שינויים בתנאי השירות

נשמרת לנו הזכות לשנות תנאים אלו. לשינויים מהותיים, נודיע בהודעה בתוך הפלטפורמה לפחות 30 יום מראש. המשך שימוש לאחר מועד הכניסה לתוקף מהווה הסכמה לשינויים.

## 14. הגנת פרטיות

איסוף ועיבוד מידע אישי כפופים למדיניות הפרטיות שלנו, המהווה חלק בלתי נפרד מתנאים אלו.

## 15. דין ישים וסמכות שיפוטית

תנאים אלו כפופים לדיני מדינת ישראל, לרבות חוק החוזים (חלק כללי), תשל"ג-1973, וחוק החוזים (תרופות בשל הפרת חוזה), תשל"א-1970. **סמכות שיפוטית ייחודית לבתי המשפט המוסמכים במחוז תל אביב-יפו.**

הצדדים מוותרים על סמכות שיפוטית בבתי משפט זרים ועל תחולת הדין הזר. הגשת תביעה בינלאומית תידון בבוררות בישראל לפי כללי מכון שנהב לבוררות, אלא אם הוסכם אחרת בכתב.

## 16. כללי

- אם ייקבע שהוראה מסוימת בתנאים אלו אינה אכיפה, שאר ההוראות יישארו בתוקפן המלא.
- אי-מימוש זכות מסוימת אינה מהווה ויתור עליה.
- תנאים אלו מהווים את ההסכם המלא בין הצדדים בנושא השירות.

## 17. יצירת קשר

לכל שאלה, הבהרה, ו/או פנייה משפטית:

**דוא"ל:** legal@rushpoint.app · spendora.tracker@gmail.com
      `,
    },
    en: {
      title: 'Terms of Service',
      updated: 'Last updated: June 2026',
      body: `
## 1. Acceptance of Terms

Welcome to RushPoint. These Terms of Service ("Terms") govern your access to and use of the RushPoint platform. RushPoint ("the Company") operates a SaaS platform for creating, launching, and managing real-world field games.

**By clicking "Create Account", joining a game, and/or using the Service in any other way, you represent that you have read, understood, and agree to these Terms in their entirety.**

If you do not agree, please do not use the Service. Minimum age: 16. If you are between 16 and 18, use is subject to parental or guardian consent.

## 2. Definitions

**"Creator"**: any person who has registered an account and creates and/or manages games.
**"Participant"**: any person who joins a game created by a Creator.
**"Run"**: a real-time game event.
**"Service"**: the entire RushPoint platform, including interfaces, API, and Cloud Functions.
**"Event Credit"**: a billing unit purchased for payment and used to launch paid runs.
**"Creator Pro"**: a paid subscription that grants Creators expanded capabilities.
**"Public Gallery"**: a public task repository to which Creators publish and from which they may borrow.

## 3. Account Registration and Details

- You agree to provide accurate and complete information at registration.
- You are responsible for keeping your password and all account credentials confidential.
- Transferring accounts, sharing access, and creating multiple accounts to circumvent restrictions are all prohibited.
- You must notify us immediately of any suspected unauthorized use of your account.
- The Company reserves the right to require identity verification in cases of suspected Terms violation.

## 4. Nature of the Service: Software Tool Only

> RushPoint is a software tool providing technological infrastructure for creating and managing events. The Company does not organize events, choose locations, provide equipment, or attend events in the field.

We provide:
- A game-design platform
- A real-time launch, management, and scoring mechanism
- Tools for team and participant management
- Technical infrastructure for data storage and processing

We do **not** provide:
- Route planning or approval
- Safety briefings
- Professional liability insurance
- On-site supervision
- Responsibility for content, strategy, or decisions made by Creators

## 5. Creator-Generated Content and the Public Gallery License

### 5.1 Content Ownership

You retain your copyright in content you create, including game names, stage descriptions, task text, images, and questions.

### 5.2 Operating License

By using the Service, you grant the Company a non-exclusive, royalty-free, assignable license to store, display, and process that content for the purpose of providing the Service. This license ends when the account is deleted.

### 5.3 Public Gallery License

By publishing a task to RushPoint's public gallery, you grant the Company and all other users of the platform:

**A non-exclusive, royalty-free, irrevocable, sublicensable license to copy, modify, translate, and incorporate the task into other games.**

This license:
- May be exercised by any other Creator on the platform without contacting you
- Permits free modification and adaptation of the original task
- Does not require attribution to the original Creator
- Does not affect your right to continue using the task and/or remove it from the gallery

**After removing a task from the gallery:** Creators who have already borrowed and/or incorporated the task into their games may continue using it, but it will no longer be available for new borrowing.

### 5.4 Content Prohibitions

It is **strictly prohibited** to create and/or upload:
- Offensive, racist, threatening, harassing, and/or degrading content
- Content that violates the privacy of specific individuals
- Content that infringes third-party copyrights and/or trademarks
- Content that directs participants to dangerous areas, private property without permission, and/or restricted facilities
- Content that contravenes any Israeli and/or international law

## 6. Creator Responsibility and Participant Physical Safety

> **This is the most important section of the Terms. Please read carefully.**

### 6.1 Creator's Full Assumption of Responsibility

Game Creators on the RushPoint platform are **independent event organizers** only. In operating a run and event, the Creator declares, confirms, and undertakes:

**(a) Site survey:** that they conducted a prior survey of all locations included in the game route, and verified that they are open to the public, safe to enter, and appropriate for the type of participants expected.

**(b) Route suitability:** that the route, pace, and level of physical demands are appropriate for the age, fitness level, and known medical limitations of their participants.

**(c) Equipment and preparedness:** that they provided appropriate safety equipment and/or instructed participants what to bring themselves.

**(d) Access to help:** that they communicated to participants how to contact first aid and/or emergency services during the event, and that an emergency number is accessible to all teams.

**(e) Permits and insurance:** that they obtained all permits required for use of any public and/or private spaces included in the route, and where necessary, purchased professional liability insurance for the event.

**(f) Legal compliance:** that the event complies with all applicable Israeli legal requirements.

### 6.2 Full Waiver of Claims against the Company

**In operating an event through RushPoint, the Creator waives any and all claims against the Company, its employees, officers, and shareholders, relating to physical, mental, material, and/or financial harm suffered by participants, third parties, and/or the Creator themselves, as a direct and/or indirect result of operating the event.**

This waiver applies whether the harm was caused by:
- Equipment failure
- Weather conditions
- Falls, injuries, and/or accidents in the field
- Entry into unsafe buildings and/or areas
- Participant behavior
- Other factors outside the Company's control

**Note:** this waiver does not limit the Company's liability in cases of intentional conduct and/or gross negligence by the Company itself.

### 6.3 Strict Safety Recommendations (Non-Exhaustive)

- **Waiver form:** obtain a legally drafted participant waiver from every participant before the event starts
- **Emergency number:** provide every team with an emergency phone number that a staff member will answer at all times
- **Clear boundaries:** communicate in writing which areas are off-limits and which activities are prohibited
- **Ongoing monitoring:** maintain contact with all teams throughout the event
- **Medical availability:** ensure access to first-aid equipment and/or a staff member trained in first aid

**RushPoint is not liable for harm caused by failure to implement these recommendations.**

### 6.4 Participant Acknowledgment

By joining a game, every participant acknowledges that they:
- Are aware this is a physical outdoor activity involving walking and/or running
- Take personal responsibility for their fitness level and suitability for the activity
- Agree that the Company is not liable for physical harm resulting from participation

## 7. Payments, Credits, and Subscriptions

### 7.1 Free Runs

Every new account receives lifetime free runs of up to 5 participants each. Free runs are not redeemable for cash.

### 7.2 Event Credits

- Credits are purchased in defined packages and used to launch paid runs
- Purchased credits do not expire
- On launching a run, the applicable credits are deducted from the wallet **at launch** with no possibility of reversal
- A refund for purchased credits is available only in the case of a verified technical failure that completely prevented the run from taking place, and only if reported within 48 hours of the scheduled start time

### 7.3 Creator Pro Subscription

- Creator Pro is a paid annual and/or monthly subscription
- Cancel anytime; cancellation takes effect at the end of the current billing period
- No pro-rated refunds for the remaining period after cancellation
- Upgrading from a monthly to an annual plan is available at any time; the difference is calculated proportionally

### 7.4 General Payment Terms

- All transactions are processed by our authorized payment processor; card details are not stored on our servers
- Prices are displayed in New Israeli Shekels (NIS) and include VAT as required by Israeli law
- Electronic receipts are sent to the account's email address
- For billing inquiries: spendora.tracker@gmail.com

### 7.5 Referral Free-Run Bonus

A Creator who refers a new Creator who registers, and a Creator who registers via a referral link, each receive an additional free run. The referral bonus is limited to one free run per successful referral. The Company reserves the right to modify and/or terminate the referral program with advance notice.

## 8. Prohibited Uses

It is strictly prohibited to use the Service for:
- Creating illegal, inciting, racist, and/or offensive content
- Collecting personal data about participants without their explicit consent
- Tracking individuals' location without their knowledge and/or consent
- Penetrating, attempting to breach, and/or bypassing the platform's security mechanisms
- Reverse-engineering the platform code
- Server overloading (DoS), bots, and/or any attempt to disrupt service availability
- Impersonating other parties
- Using the Service for a competing business and/or to build a similar product

## 9. Limitation of the Company's Liability

The Service is provided "as is" and "as available." To the extent permitted by Israeli law:

**(a) No content liability:** the Company is not liable for content created by Creators, its accuracy, truthfulness, and/or legality.

**(b) No indirect damages:** the Company will not bear indirect, consequential, incidental, punitive damages, or damages for loss of revenue and/or goodwill.

**(c) Liability cap:** in any event, the Company's total liability shall not exceed the amount you paid to the Company in the 12 months preceding the damage event.

**(d) Force majeure:** the Company will not bear liability for service unavailability and/or data loss resulting from events beyond its reasonable control.

**For physical safety:** see Section 6 above.

## 10. Indemnification

You agree to indemnify and defend the Company, its employees, officers, and shareholders from any claim, damage, loss, cost, and/or expense (including reasonable attorney's fees) arising from:
- Your breach of these Terms
- Your violation of third-party rights
- Content you created and/or published
- An event you operated, including any tort claim from participants

## 11. Intellectual Property

The platform itself, including source code, design, routing algorithms, user interface, and these policy documents, belongs to the Company and is protected by copyright. Copying, reproducing, and/or distributing without written permission from the Company is prohibited. The Company's trademarks may not be used without prior approval.

## 12. Account Suspension and Termination

The Company reserves the right to suspend and/or close an account:
- With advance notice: for repeated violations and/or abuse of the Service
- Without advance notice: for serious violations, illegal content, and/or an immediate safety risk

Upon account closure, purchased credits will be refunded proportionally, except where closure results from a Terms violation.

## 13. Changes to Terms of Service

We reserve the right to modify these Terms. For material changes, we will provide notice within the platform at least 30 days in advance. Continued use after the effective date constitutes acceptance of the changes.

## 14. Privacy Protection

Collection and processing of personal data is governed by our Privacy Policy, which forms an integral part of these Terms.

## 15. Governing Law and Jurisdiction

These Terms are governed by Israeli law, including the Contracts Law (General Part) 5733-1973 and the Contracts Law (Remedies for Breach of Contract) 5731-1970. **Exclusive jurisdiction is conferred on the competent courts of the Tel Aviv-Jaffa District.**

The parties waive jurisdiction of foreign courts and the application of foreign law. International disputes shall be resolved by arbitration in Israel under the rules of the Israeli Arbitration Institute, unless otherwise agreed in writing.

## 16. General

- If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full force and effect.
- Failure to exercise any right does not constitute a waiver of that right.
- These Terms constitute the entire agreement between the parties regarding the Service.

## 17. Contact

For any question, clarification, and/or legal inquiry:

**Email:** legal@rushpoint.app · spendora.tracker@gmail.com
      `,
    },
  },
};

// ---------------------------------------------------------------------------
// Markdown renderer — supports ## h2, ### h3, > blockquote, **bold**, - list
// ---------------------------------------------------------------------------
function renderMarkdown(text: string) {
  const lines = text.trim().split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('## ')) {
      return (
        <h2 key={i} className="text-lg font-bold text-[--ink-1] mt-8 mb-2 pb-1 border-b border-[--rp-border] first:mt-0">
          {line.slice(3)}
        </h2>
      );
    }
    if (line.startsWith('### ')) {
      return (
        <h3 key={i} className="text-base font-semibold text-[--ink-1] mt-5 mb-1">
          {line.slice(4)}
        </h3>
      );
    }
    if (line.startsWith('> ')) {
      const content = renderInline(line.slice(2));
      return (
        <div
          key={i}
          className="border-l-4 border-rp-fire bg-rp-fire/10 px-4 py-2 my-3 rounded-r-lg text-sm text-[--ink-1] font-medium"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      );
    }
    if (line.startsWith('**') && line.endsWith('**') && !line.slice(2, -2).includes('**')) {
      return (
        <p key={i} className="font-semibold text-[--ink-1] mt-3">
          {line.slice(2, -2)}
        </p>
      );
    }
    if (line.startsWith('- ')) {
      const content = renderInline(line.slice(2));
      return (
        <li
          key={i}
          className="text-[--ink-2] text-sm leading-relaxed ms-4 list-disc"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      );
    }
    if (line === '') return <div key={i} className="h-1.5" />;
    const content = renderInline(line);
    return (
      <p
        key={i}
        className="text-[--ink-2] text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface LegalPageProps {
  type: DocType;
  lang?: 'he' | 'en';
  standalone?: boolean;
}

export default function LegalPage({ type, lang = 'he', standalone = false }: LegalPageProps) {
  const [activeLang, setActiveLang] = useState<'he' | 'en'>(lang);
  const nav = useNavigate();
  const doc = SECTIONS[type][activeLang];

  const content = (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          {!standalone && (
            <button
              onClick={() => nav(-1)}
              className="text-sm text-[--ink-3] hover:text-[--ink-1] transition-colors mb-3 flex items-center gap-1.5"
            >
              {activeLang === 'he' ? '← חזרה' : '← Back'}
            </button>
          )}
          <h1 className="font-brand text-3xl font-extrabold text-[--ink-1]">{doc.title}</h1>
          <p className="text-xs text-[--ink-3] mt-1">{doc.updated}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-[--surface-2] p-0.5 self-start">
          {(['he', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setActiveLang(l)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeLang === l
                  ? 'bg-[--surface-0] text-[--ink-1] shadow-sm'
                  : 'text-[--ink-3] hover:text-[--ink-1]'
              }`}
            >
              {l === 'he' ? 'עברית' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <div
        dir={activeLang === 'he' ? 'rtl' : 'ltr'}
        className="prose-sm space-y-1 border border-[--rp-border] rounded-2xl p-6 bg-[--surface-0]/60"
      >
        {renderMarkdown(doc.body)}
      </div>
    </div>
  );

  if (standalone) {
    return (
      <div className="min-h-screen bg-[--surface-1] text-[--ink-1]">
        <div className="h-14 border-b border-[--rp-border] flex items-center px-5">
          <span className="font-brand text-lg font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
            RushPoint
          </span>
        </div>
        {content}
      </div>
    );
  }

  return content;
}
