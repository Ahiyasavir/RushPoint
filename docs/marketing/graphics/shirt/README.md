# חולצת RushPoint

חזית: המצפן ו RushPoint, ברוחב 8 ס"מ. גב: "תבנו מירוץ / לחברים שלכם", "בחינם. סרקו ותראו איך", קוד ו RushPoint, ברוחב 11 ס"מ.

| קובץ | מה זה |
|---|---|
| `shirt-<black|white>-<front|back>-print.png` | לבית הדפוס: רקע שקוף, 600 DPI |
| `shirt-<black|white>-<front|back>.svg` | אותו דבר בווקטור (הגופן Rubik מוטמע) |
| `shirt-<black|white>-<front|back>-preview.png` | לצפייה בלבד, על צבע החולצה |

הקוד מוביל ל `https://rush-point.com/t`, הפניה 302 ב `firebase.json` (אתר marketing) אל `/he/?utm_source=shirt&utm_medium=qr&utm_campaign=tshirt`. כדי לשנות לאן הקוד מוביל, משנים את ההפניה ולא מדפיסים מחדש. את הסריקות סופרים ב Google Analytics לפי `utm_source=shirt`. הבדיקה `scripts/test-marketing-hosting.ts` (קבוצה E) שומרת שההפניה קיימת.

בחולצה השחורה הקוד יושב על לוח בהיר בכוונה: קוד בהיר על רקע כהה נקרא רק בסורקים שמנסים להפוך צבעים.

בנייה מחדש: `node docs/marketing/graphics/shirt/build.mjs "$(pwd)" "$(pwd)/docs/marketing/graphics/shirt"`, ואחריה `node docs/marketing/graphics/shirt/verify.mjs "$(pwd)" "$(pwd)/docs/marketing/graphics/shirt"` שמפענח את הקוד מכל קובץ גב בכמה גדלים.
