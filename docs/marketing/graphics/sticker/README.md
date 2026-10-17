# מדבקות RushPoint

ארבע מדבקות בחיתוך צורה (die cut). בכל אחת כבר יש שוליים לבנים של 3 מ"מ לקו החיתוך.

| מדבקה | גודל עם השוליים | מה יש עליה |
|---|---|---|
| `icon` | 66 x 66 מ"מ | אייקון האפליקציה: ריבוע מעוגל כתום עם המצפן |
| `badge` | 76 x 76 מ"מ | עיגול שחור, מצפן ו RushPoint |
| `pill` | 96 x 36 מ"מ | פס שחור, מצפן ו RushPoint, ללפטופ או לבקבוק |
| `qr` | 66 x 98 מ"מ | "תבנו מירוץ / לחברים שלכם", קוד ל `https://rush-point.com/t` ו RushPoint |

`sticker-<name>-print.png` לבית הדפוס (רקע שקוף, 600 DPI). `sticker-<name>.svg` אותו דבר בווקטור. `sticker-sheet-preview.png` לצפייה בלבד, על אפור כדי שיראו את השוליים הלבנים.

הקוד מוביל לאותה הפניה כמו בחולצה, ראו `../shirt/README.md`.

בנייה מחדש: `node docs/marketing/graphics/sticker/build.mjs "$(pwd)" "$(pwd)/docs/marketing/graphics/sticker"`.
