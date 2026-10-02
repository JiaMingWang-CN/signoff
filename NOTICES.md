# 第三方组件许可

Signoff 本体采用 [MIT 许可证](LICENSE)。分发或二次开发本项目时，请同时遵守下列第三方组件的各自许可条款（版本以 `backend/requirements*.txt` 与 `frontend/package-lock.json` 为准）。

## 需要特别声明的组件

| 组件 | 许可 | 说明 |
|---|---|---|
| `gsap` / `@gsap/react` | [GreenSock Standard "No Charge" License](https://gsap.com/standard-license) | 首页动画使用。全部插件（含 SplitText、ScrollTrigger）免费商用、无需会员密钥；但该许可不是 OSI 开源许可，禁止把 GSAP 本体作为动画库转售 |
| `psycopg` / `psycopg-binary` | LGPL-3.0-only | PostgreSQL 驱动（可选）。仅作为运行时依赖引入，本项目不分发其二进制，故不传染本项目许可；再分发 wheel 时须保留 LGPL 声明 |
| Inter、JetBrains Mono、Instrument Serif（经 `@fontsource` 分发） | SIL Open Font License 1.1 | 字体文件许可；使用时须保留字体许可与版权声明 |

## 其他依赖

`backend/requirements.txt`、`backend/requirements-demo.txt`、`frontend/package.json` 中的其余组件均为 MIT / Apache-2.0 / BSD-3-Clause / ISC 等宽松许可。

外部工具 codegraph CLI（由用户按 README 自行安装 `@colbymchenry/codegraph`）为 MIT 许可，不属于本仓库依赖树。
