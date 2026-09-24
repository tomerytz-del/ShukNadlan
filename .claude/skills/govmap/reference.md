# ‏GovMap API — תקציר עבודה

מקוצר מ-`https://api.govmap.gov.il/docs` (ספטמבר 2026). מה שכאן הוא מה
שרלוונטי לאתר; התיעוד המקורי מכריע כשיש סתירה. הסקריפט:

```html
<script src="https://www.govmap.gov.il/govmap/api/govmap.api.js"></script>
```

כל הפונקציות מחזירות promise (חלקן `.progress` לאירועים חוזרים). קריאה
שנדחתה בגלל טוקן/דומיין **אינה** דוחה את ה-promise באופן אמין — היא מציגה
הודעה ומתעלמת. לכן בודקים את צורת התשובה, לא רק `catch`.

## ‏א. בלי מפה (הכי שימושי לנו)

הטוקן נשלח בכל קריאה; אין צורך ב-`createMap`.

| פונקציה | קלט | פלט | שימוש אצלנו |
| --- | --- | --- | --- |
| `govmap.search(p)` | `{apiKey, searchText, language?, maxResults?, isAccurate?, layers?}` | `{resultsCount, results: SearchData[], aggregations}` | גאוקוד, השלמה אוטומטית לרחוב/עיר |
| `govmap.getSearchResultData(r, token)` | ‏`SearchData` מ-`search` | `{text, centroid, type, geom}` | גאומטריה מלאה (רחוב כקו, שכונה כמצולע) |
| `govmap.getLayerFeaturesByLocation(p, token)` | `{geometry?, address?, radius≤3000, layers:[{name, fields}]}` | `{location, layers: {name: [{attributes, id}]}}` | "מה ליד הנכס": בתי ספר, גנים, תחבורה, חלקה |
| `govmap.getLayerFilterFields(layer, token, lang?)` | שם שכבה | שדות, סוגים, התפלגות ערכים | גילוי מבנה שכבה לפני שכותבים קוד |

‏`address` ב-`getLayerFeaturesByLocation` דורש הפעלת שכבת "כתובות" בממשק
ניהול ה-API באזור האישי. עדיף `geometry` (‏WKT ב-ITM) + ‏`radius`.

### ‏SearchData

`{ id: "address|ADDR|460875", text, type, score, centroid: "POINT (x y)", data, layerId?, objectId? }`

### ‏Datatypes ל-`layers` ב-`search`

`settlement` יישוב · `neighborhood` שכונה · `street` רחוב · `address` כתובת ·
`block` גוש · `parcel` חלקה · `statistic` אזור סטטיסטי · `institutes` מוסדות ·
`poi` · `junction` · `ways` · `parks`

## ‏ב. דורש מפה (`createMap`)

```js
govmap.createMap('map', { token, layers: [...], visibleLayers: [...], background: '0',
  center: {x, y}, level: 8, identifyOnClick: true, layersMode: 4, zoomButtons: true,
  onLoad: () => {...} });
```

| פונקציה | הערה |
| --- | --- |
| `searchAndLocate({type, address} / {type, lot, parcel})` | גוש/חלקה ↔ כתובת. **שמות ה-enum הפוכים** — ראו SKILL.md סעיף 4. מחזיר `settlementCode`, `streetCode` (סמלי למ"ס) |
| `intersectFeatures({address|geometry, layerName, fields, whereClause?, radius?})` | ישויות בשכבה בנקודה/כתובת. דוגמה: `PARCEL_ALL` + `['GUSH_NUM','PARCEL']` |
| `identifyByXY(x, y)` / `identifyByXYAndLayer(x, y, layers)` | תלוי זום. ‏`centroid` בתשובה ב-**3857**, ‏`geom` ב-ITM |
| `getLayerData({LayerName, Point:{x,y}, Radius})` | ישויות ברדיוס + מרחק |
| `displayGeometries({wkts, names, geometryType, defaultSymbol, data:{tooltips, headers, bubbleHTML, bubbleHTMLParameters}})` | ציור נכסים על מפת GovMap. **כל ערך → `escapeHtml`** |
| `setHeatLayer({points:[{point:{x,y}, attributes:{val1}}], options:{valueField:'val1'}})` | מפת חום (מחיר למ"ר) |
| `filterLayers({layerName, whereClause, zoomToExtent})` | |
| `zoomToXY({x, y, level, marker})`, `setMapMarker({x,y})`, `setBackground(id)`, `setVisibleLayers(on, off)` | |
| `onEvent(govmap.events.CLICK).progress(cb)` | ‏`cb(e)`: ‏`e.mapPoint.x/y` ב-ITM |
| `geocode({keyword, type})` | **לא לגאוקוד נכסים** — ‏ResultCode 3 מערבב "אין" עם "יותר מאחד" |

## ‏ג. קישור (בלי טוקן, בלי קוד)

```
https://www.govmap.gov.il/?c=179449,663927&z=9&b=1&lay=PARCEL_ALL
https://www.govmap.gov.il/?q=<encodeURIComponent(כתובת)>&z=10
```

| פרמטר | ערכים |
| --- | --- |
| `c` | ‏`x,y` ב-ITM (‏X ‏100k-300k, ‏Y ‏370k-810k) או lng,lat |
| `z` | ‏0-10 |
| `b` | ‏0 רחובות · 1 תצלום אוויר · 2 משולב · 15 אנגלית |
| `lay` | שמות שכבות, מופרדים בפסיק |
| `q` | חיפוש חופשי; מנווט לתוצאה הראשונה |
| `bs` | בועית: `LAYER|x,y` או `LAYER|FIELD~value` (לקודד עברית) |

**הטמעת iframe חוסמת את עצמה אצלנו?** לא: ‏`X-Frame-Options: DENY` מונע
מאחרים להטמיע **אותנו**. הטמעה של GovMap בדף שלנו דורשת רק את
`frame-src` ב-CSP.

## ‏ד. שכבות ציבוריות רלוונטיות

| שכבה | מה |
| --- | --- |
| `PARCEL_ALL` / `SUB_GUSH_ALL` | חלקות / גושים |
| `neighborhoods_area` / `Neighborhood` | שכונות (מצולע / נקודה) |
| `retzefMigrashim` | מגרשי תב"ע - רמ"י |
| `migrashim_msbs` | מגרשים - משרד הבינוי |
| `school` / `kids_g` | בתי ספר / גני ילדים |
| `bus_stops` | תחנות אוטובוס |
| `local_committees` | ועדות מקומיות |

שם שכבה לא ידוע: להדליק אותה ידנית ב-govmap.gov.il, "שתף", ולקרוא את
`lay=` מה-URL. שמות משתנים — לא לקודד רשימה ארוכה בלי לבדוק.

## ‏ה. ‏enums

```
events: PAN 0 · EXTENT_CHANGE 1 · CLICK 3 · DOUBLE_CLICK 4 · MOUSE_MOVE 5 · MOUSE_OVER 8
locateType: addressToLotParcel 1 · lotParcelToAddress 0
geometryType: POINT 0 · POLYLINE 1 · POLYGON 2 · LINE 3 · CIRCLE 4
drawType: Point 0 · Polyline 1 · Polygon 2 · Circle 3 · Rectangle 4 · FreehandPolygon 6
geocodeType: FullResult 0 · AccuracyOnly 1
```
