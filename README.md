# WGS84 UTM 投影双向换算服务

基于 **Node.js 20 + Fastify** 的无状态纯换算后端，提供 WGS84 通用横轴墨卡托
（UTM）投影的**正算 / 反算 / 分带查询**。正反两支采用同一套高精度 Krüger
级数，严格互逆；不使用任何球面近似。

- 椭球：WGS84（a = 6378137 m，1/f = 298.257223563）
- 比例因子：中央经线 **k0 = 0.9996**（钉死）
- 假东：**500000 m**；南半球假北：**10000000 m**
- 级数出处：**USGS Professional Paper 1395《Map Projections — A Working
  Manual》(Snyder, 1987) 第 8 章 UTM 的 Krüger n-展开**
  - 正算坐标：式 (8-13)/(8-14)，保留到 A⁶
  - 点比例因子：式 (8-15)
  - 反算底点纬度：式 (8-19)/(8-20)，保留到 e₁⁴
  - 反算经纬度：式 (8-17)/(8-18)，分别保留到 D⁶ / D⁵
  - 子午线弧长 M(φ)：式 (3-21/3-22)，保留到 e⁶
- 往返闭合精度：全球随机点正算→反算，纬度误差 < 1×10⁻⁸ 度、
  经度误差 < 2×10⁻⁸ 度（**亚毫米级**，见 `test/03-roundtrip.test.js`）

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

### 2. 反算 `POST /api/v1/inverse`

带号 + 平面坐标 → 经纬度（度）。UTM 北坐标本身无法区分南北半球，
因此南半球必须显式给 `"hemisphere": "S"`（缺省按北半球 `N`）。

```bash
curl -X POST http://127.0.0.1:8080/api/v1/inverse \
  -H 'content-type: application/json' \
  -d '{"zone":50,"easting":448502.182,"northing":4417797.609,"hemisphere":"N"}'
# → lat 39.9087, lon 116.3975
```

### 3. 分带查询 `POST /api/v1/zone`（或 `GET /api/v1/zone?lon=116.3975`）

```json
{ "ok": true, "result": { "lon": 116.3975, "zone": 50, "centralMeridian": 117 } }
```

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
| 反算经纬度落回投影域之外 | `INVERSE_OUT_OF_DOMAIN` |

反算在校验平面坐标粗范围后，还会把反算得到的经纬度再做一次权威域校验，
拦截“勉强通过粗检但实际跨出投影带”的输入。

**角度单位纪律**：度 ⇄ 弧度的换算只在 `src/core/angles.js` 一处定义、
只在服务边界调用一次，级数内部全程使用弧度，杜绝“把度当弧度又乘一次”的
典型错误；非数值经纬度直接判 `INVALID_TYPE`。

---

## 代码结构（按职责拆模块）

```
src/
  core/
    constants.js    WGS84 椭球常数、k0/假偏移、合法域
    angles.js       唯一的角度换算点（度⇄弧度）
    errors.js       ValidationError 与类型化错误码表
    zones.js        分带规则、中央经线、带号合法性、强制带号判定
    meridian.js     子午线弧长 M(φ) 与反算底点纬度（弧长子级数）
    tmForward.js    横轴墨卡托正算 Krüger 级数（式 8-13/14/15）+ 收敛角
    tmInverse.js    横轴墨卡托反算 Krüger 级数（式 8-16..8-23）
    validation.js   全部输入/输出校验
    utm.js          门面：分带+正/反算+假偏移+强制带标注+示范点（纯函数 API）
  app.js            Fastify 路由与统一错误处理
  server.js         启动入口
test/               Node 内置 test runner，50 个用例
```

### 并发安全

换算内核全部是**无状态纯函数**：无共享可变状态、不落任何库，模块加载后
只读常量。Fastify 单事件循环处理并发请求时各自独立、互不串扰
（`test/06-http.test.js` 含 300 个并发混合正/反算请求的隔离测试）。

---

## 正确性判据与测试

`npm test` 运行 50 个用例，覆盖需求中彼此独立、方向不同的各条判据：

1. **往返自洽（核心）**：全球格网点 + 500 个确定性随机点 + 带界接缝点，
   正算→反算还原经纬度，亚毫米闭合；反算→正算坐标层面也互逆
   （`03-roundtrip.test.js`）。正反级数任何一处系数写错都会在此漂移。
2. **赤道 / 中央经线基准**：(0°, λ0) 正算东坐标 = 500000、北坐标 = 0；
   中央经线上比例因子恒为 0.9996、东坐标恒为 500000
   （`02-forward-baseline.test.js`）。
3. **比例因子单调**：从中央经线向东偏离时 k 单调升高，东西对称点相等。
4. **南北半球配对**：南纬点北坐标 = 10000000 − 同经度北纬点北坐标。
5. **差一个带识别**：分带结果必须等于最近中央经线；用相邻错带正算时
   东坐标整整偏离约一个带宽（赤道 ≈ 668–672 km）；并对“分带公式被改成
   +2”的变异注入做了检出测试（`04-off-by-one-zone.test.js`）。
6. **子午线收敛角**：中央经线/赤道为零、东正西负、与一阶 γ≈Δλ·sinφ
   吻合。
7. **各类非法输入**：纬度/经度越界、带号非法、东/北坐标越界、半球非法、
   类型错误、缺字段、反算落出投影域，逐一断言不同错误码
   （`05-validation.test.js`）。
8. **HTTP 层**：全部接口的 POST/GET、结构化 400 错误、非法 JSON、404、
   并发隔离（`06-http.test.js`）。
