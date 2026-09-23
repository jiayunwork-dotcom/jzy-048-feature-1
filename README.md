# 多基准椭球 UTM 投影双向换算服务

基于 **Node.js 20 + Fastify** 的无状态纯换算后端，提供通用横轴墨卡托
（UTM）投影的**正算 / 反算 / 分带查询**。正反两支采用同一套高精度 Krüger
级数，严格互逆；不使用任何球面近似。

- 椭球：**按请求可选**，缺省 **WGS84**（a = 6378137 m，1/f = 298.257223563）。
  内置基准：`WGS84`、`GRS80`（1/f = 298.257222101）、
  `BESSEL_1841`（a = 6377397.155，1/f = 299.1528128）、
  `CLARKE_1866`（a = 6378206.4，1/f = 294.9786982）。
  长半轴/扁率为权威定义值，第一/第二偏心率平方等派生量由
  `src/core/ellipsoids.js` 从定义统一推导，再喂给同一套 Krüger 级数。
- 比例因子：中央经线 **k0 = 0.9996**（钉死，与椭球无关）
- 假东：**500000 m**；南半球假北：**10000000 m**（UTM 层约定，不随椭球变）
- 级数出处：**USGS Professional Paper 1395《Map Projections — A Working
  Manual》(Snyder, 1987) 第 8 章 UTM 的 Krüger n-展开**
  - 正算坐标：式 (8-13)/(8-14)，保留到 A⁶
  - 点比例因子：式 (8-15)
  - 反算底点纬度：式 (8-19)/(8-20)，保留到 e₁⁴
  - 反算经纬度：式 (8-17)/(8-18)，分别保留到 D⁶ / D⁵
  - 子午线弧长 M(φ)：式 (3-21/3-22)，保留到 e⁶
- 往返闭合精度：每一种内置椭球上全球随机点正算→反算，纬度误差 < 1×10⁻⁸ 度、
  经度误差 < 2×10⁻⁸ 度（**亚毫米级**，见 `test/07-ellipsoids.test.js`）
- **默认兼容底线**：不传椭球字段时，输出与单椭球版本**逐位一致**
  （坐标、比例因子、收敛角均以 `Object.is` 严格判等，
  基线快照见 `test/fixtures/wgs84-forward-baseline.json`）。

---

## 一条命令构建并启动

```bash
./run.sh            # 构建镜像并启动，默认宿主端口 8080
./run.sh 9090       # 换宿主端口
```

等价的手动命令：

```bash
docker build -t wgs84-utm-service:latest .
docker run -d --name wgs84-utm-service -p 8080:8080 wgs84-utm-service:latest
```

容器以非 root 用户运行、内置 `/health` 健康检查。停止：`docker rm -f wgs84-utm-service`。

### 不用容器时（本机需 Node.js 20）

```bash
npm install
npm start           # 默认 0.0.0.0:8080，可用 PORT / HOST / LOG_LEVEL 覆盖
npm test            # 运行全部自动化测试（Node 内置 test runner，零额外依赖）
```

---

## HTTP 接口

所有接口同时支持 `POST application/json` 和 `GET`（query 参数）。
成功返回 `{ "ok": true, "result": {...} }`；非法输入返回 HTTP 400 与
**带类型错误码**的结构化错误：

```json
{ "error": { "code": "LAT_OUT_OF_RANGE", "message": "…", "details": { } } }
```

### 1. 正算 `POST /api/v1/forward`

经纬度（度）→ 带号、东坐标、北坐标、点比例因子、子午线收敛角。

```bash
curl -X POST http://127.0.0.1:8080/api/v1/forward \
  -H 'content-type: application/json' \
  -d '{"lat": 39.9087, "lon": 116.3975}'
```

```json
{
  "ok": true,
  "result": {
    "zone": 50,
    "hemisphere": "N",
    "easting": 448502.1819542134,
    "northing": 4417797.609404602,
    "scale": 0.9996326479877631,
    "convergence": { "radians": -0.0067466063, "degrees": -0.3865520667 },
    "centralMeridian": 117,
    "autoZone": 50,
    "zoneForced": false,
    "zoneForcedReason": null,
    "datum": "WGS84"
  }
}
```

**强制带号**：请求体可带 `"zone": 49`。当它与按经度自动分带结果不一致时，
服务**以调用方指定带号为准**，同时显式返回 `"zoneForced": true`、
`"autoZone"` 与中文原因说明，让调用方知道自己跨带了，结果不会被静默改带。

**指定椭球**：请求体可带 `"ellipsoid": "BESSEL_1841"`（GET 用 query 参数
`ellipsoid=`）。大小写与首尾空白不敏感，并接受常见别名
（如 `BESSEL`、`CLARKE`、`GRS 1980`、`WGS-84`）。响应里
`ellipsoid`（以及兼容保留的 `datum`）回显实际使用的规范标识：

```bash
curl -X POST http://127.0.0.1:8080/api/v1/forward \
  -H 'content-type: application/json' \
  -d '{"lat": 47.3769, "lon": 11.9234, "ellipsoid": "BESSEL_1841"}'
# → easting 720650.7788, northing 5250658.4377, ellipsoid "BESSEL_1841"
```

不传该字段（或显式传 `"WGS84"`）时与历史行为**逐位一致**；
传未收录标识（如 `"XIAN80"`、`null`、数字）返回
`400 INVALID_ELLIPSOID` 结构化错误，**绝不会静默按 WGS84 计算**。

注意：正算与反算必须使用**同一个椭球标识**，否则坐标无法还原。

### 2. 反算 `POST /api/v1/inverse`

带号 + 平面坐标 → 经纬度（度）。UTM 北坐标本身无法区分南北半球，
因此南半球必须显式给 `"hemisphere": "S"`（缺省按北半球 `N`）。
同样可带 `"ellipsoid"`，且必须与正算该坐标时的椭球一致。

```bash
curl -X POST http://127.0.0.1:8080/api/v1/inverse \
  -H 'content-type: application/json' \
  -d '{"zone":50,"easting":448502.182,"northing":4417797.609,"hemisphere":"N"}'
# → lat 39.9087, lon 116.3975（默认 WGS84）
```

### 3. 分带查询 `POST /api/v1/zone`（或 `GET /api/v1/zone?lon=116.3975`）

```json
{ "ok": true, "result": { "lon": 116.3975, "zone": 50, "centralMeridian": 117 } }
```

分带是纯经度到带号的映射，**与椭球几何无关**：请求即使带了
`ellipsoid` 字段（哪怕是非法值）也会被忽略，结果与默认完全一致。

分带规则（钉死）：

```
带号      n = floor((经度 + 180) / 6) + 1
中央经线  λ0 = 3 + 6·(n − 1) − 180   （度）
```

经度 180° 按 UTM 约定并入第 60 带；带界经度（如 114°、120°）归东侧带。

### 4. 辅助

- `GET /health`：健康检查
- `GET /demo`：预置的**中国境内示范点**（北京·天安门附近，39.9087°N /
  116.3975°E），自动落在 **50N** 带、东坐标 **448502 m**（40 万–60 万之间），
  一调即可确认级数展开正确
- `GET /`：服务说明 + 接口目录 + 示范点

### 子午线收敛角符号约定

以**真子午线北方向**为准，坐标纵线（格网北）北端偏在真子午线**以东为正**、
以西为负（中国测绘《控制测量学》及 EPSG 通用约定）。中央经线以东 γ>0、
以西 γ<0；中央经线与赤道上 γ=0；一阶近似 γ ≈ Δλ·sin φ。

---

## 输入校验（结构化错误，绝不硬算）

| 情形 | 错误码 |
|---|---|
| 纬度超出 UTM 域（约 −80° ~ 84°） | `LAT_OUT_OF_RANGE` |
| 经度超出 [−180, 180] | `LON_OUT_OF_RANGE` |
| 带号非 1..60 整数 | `INVALID_ZONE` |
| 东坐标明显越界（带内物理范围约 160–834 km） | `EASTING_OUT_OF_RANGE` |
| 北坐标明显越界（按南/北半球分别判定） | `NORTHING_OUT_OF_RANGE` |
| 半球标识不是 N/S | `INVALID_HEMISPHERE` |
| 字段不是有限数（字符串/NaN/Infinity/布尔） | `INVALID_TYPE` |
| 必填字段缺失 | `MISSING_FIELD` |
| 反算经纬度落回投影域之外（带号/坐标/椭球不自洽） | `INVERSE_OUT_OF_DOMAIN` |
| 椭球标识非法或未收录（`null`/非字符串/空白/未知） | `INVALID_ELLIPSOID` |

反算在校验平面坐标粗范围后，还会把反算得到的经纬度再做一次权威域校验，
拦截“勉强通过粗检但实际跨出投影带”的输入。**这层校验按请求指定的椭球
执行，不会因为多了椭球参数而被绕过**：北坐标粗范围取该椭球自身的子午线
弧长跨度；东坐标带宽阈值是 UTM 层几何（k0 + 6° 经差），对所有椭球一致。

**角度单位纪律**：度 ⇄ 弧度的换算只在 `src/core/angles.js` 一处定义、
只在服务边界调用一次，级数内部全程使用弧度，杜绝“把度当弧度又乘一次”的
典型错误；非数值经纬度直接判 `INVALID_TYPE`。

---

## 代码结构（按职责拆模块）

```
src/
  core/
    constants.js    UTM 投影常数（k0/假偏移/合法域），转出默认 WGS84 派生量
    ellipsoids.js   【新】基准椭球定义表（WGS84/GRS80/Bessel1841/Clarke1866）
                    与按需派生 f,b,e²,e'²,e1,M1..M4 的唯一推导点
    angles.js       唯一的角度换算点（度⇄弧度）
    errors.js       ValidationError 与类型化错误码表
    zones.js        分带规则、中央经线、带号合法性、强制带号判定
    meridian.js     子午线弧长 M(φ) 与反算底点纬度（弧长子级数，按椭球传参）
    tmForward.js    横轴墨卡托正算 Krüger 级数（式 8-13/14/15）+ 收敛角（按椭球传参）
    tmInverse.js    横轴墨卡托反算 Krüger 级数（式 8-16..8-23，按椭球传参）
    validation.js   全部输入/输出校验（北坐标粗范围随椭球几何推导）
    utm.js          门面：分带+正/反算+假偏移+强制带标注+示范点（纯函数 API）
  app.js            Fastify 路由与统一错误处理
  server.js         启动入口
test/               Node 内置 test runner，87 个用例
  fixtures/         改造前 WGS84 正算逐位基线快照（100 个全球点）
```

椭球常数与派生推导**单独成模块**（`ellipsoids.js`），不与分带、正反算
级数混在一起；`meridian.js / tmForward.js / tmInverse.js` 内不内嵌任何
具体椭球数值表，只接收派生量对象。级数函数的最后一个参数省略时取
WGS84，且算式与求值顺序与改造前逐位相同。

### 并发安全

换算内核全部是**无状态纯函数**：椭球表与派生结果在模块加载时一次性算完
并冻结（`Object.freeze`），运行期只读、不缓存任何按请求变化的量，
多椭球计算**没有引入任何跨请求共享的可变状态**。Fastify 单事件循环并发时，
不同请求各自携带不同椭球标识、互不串扰（`test/06-http.test.js` 含
300 个并发混合椭球正/反算请求的隔离测试，`test/07-ellipsoids.test.js`
另有 400 个交错请求的内核级隔离测试）。

---

## 正确性判据与测试

`npm test` 运行 87 个用例。除下列多椭球专项判据外，原有的
往返/分带/校验/HTTP 判据（`00`–`06` 号测试）全部原样保留：

- **默认路径逐位兼容**：100 个全球点相对改造前快照的东/北坐标、比例因子、
  收敛角（弧度+度）以 `Object.is` 严格判等；底层 `meridianArc / project /
  unproject` 的原始数值也逐位比对；显式 `"ellipsoid":"WGS84"` 与缺省结果相同
  （`07-ellipsoids.test.js` 第 1 组）。
- **三种新增椭球各自往返闭合**：`GRS80 / BESSEL_1841 / CLARKE_1866` 在全球
  格网点、120 个确定性随机点、带界接缝、南/北半球上分别正算→反算，
  亚毫米闭合；反算→正算坐标层面也互逆。不是只在默认椭球上测。
- **同点不同椭球坐标必须不同**：同一点（非赤道+中央经线原点）换椭球，
  东坐标、北坐标、比例因子、收敛角全部与 WGS84 不相等——含与 WGS84 仅差
  10⁻¹⁰ 相对量级的 GRS80（选近带边缘高点放大差异，断言差值 > 0 且超过
  双精度舍入）；并把服务结果与“用该椭球派生量在级数层现算”的结果逐位比对，
  抓“只换标签、内部仍按 WGS84 算”的实现。
- **派生量真的来自新椭球**：f/b/e²/e'²/e1/M1..M4 用独立公式重算核对；
  各椭球 `M(φ)` 与其自身被积函数 `a(1−e²)/(1−e²sin²u)^(3/2)` 的高分辨率
  Simpson 数值积分一致（< 0.01 m）。
- **混椭球不闭合可被抓住**：Bessel 正算结果喂给 WGS84 反算，经纬度偏差
  数百米，必然超过闭合容差。
- **非法椭球标识**：未知标识、空白、`null`、数字、布尔、对象 →
  `INVALID_ELLIPSOID`，错误体带 `received` 与 `supported` 明细。
- **带号/坐标/椭球不自洽**：东坐标越界、北坐标越界（粗范围按各椭球自身
  弧长跨度）、带号非法、半球非法、反算经度跨出 [-180,180]，在每种椭球下
  都仍被既有校验拦下。
- **分带与椭球无关**：`/api/v1/zone` 对 `ellipsoid` 字段（含非法值）一律忽略。
- **原点退化例外**：赤道+中央经线处各椭球恒为 (500000, 0, k=0.9996, γ=0)，
  这是 UTM 层假偏移/k0 约定所致，属预期且有显式测试。
