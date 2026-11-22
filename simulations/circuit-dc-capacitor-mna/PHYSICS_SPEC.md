# B2 自由拓扑电路建模器（`builder-circuit-mna`）物理建模规范

- **规范 ID**：`builder-circuit-mna`（兼容 V1.0 旧 ID：`circuit-dc-capacitor-mna`）
- **核心算法**：改进节点电压法（MNA）+ 列主元 LU 消元 + 孤岛 $G_{\min}=10^{-12}\text{ S}$ 泄放 + 电容/电感二阶梯形伴随模型 + Newton-Raphson 非线性迭代（幂律小灯泡、肖克利二极管阻尼步长限幅防指数溢出）。
- **异常处理**：电源极端短路极限下触发 `SHORT_CIRCUIT` 事件提示，杜绝 `NaN`/`Infinity`。
- **V2 能力**：`ControlHandle` 画布拖拽变阻、`SceneDSL` 序列化及 `DiagramIR` 黑白标准电路图导出。
