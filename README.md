# dsh-prompt-loader

一个 DSH host 插件，把一段系统提示词作为独立 section 注入到 Agent。支持从 `<语言ID>.txt` 目录读取，也支持在 `pack.texts` 中按语言 ID 直接传入并由设置页在线编辑，语言切换、配置变更或文件变动时均会自动热重注册，无需重启 DSH。

此包是 [`dsh-pirate-mode`](https://github.com/butterfly301/dsh-pirate-mode) 的组件，也可以单独安装使用。

## 作用

`systemPrompt.section()` 注册的 section 支持动态注销与重注册。本插件监听 `settings/document-updated`（`locale` 与自身命名空间）、`loader/volatile-update` 以及目录的文件变动，重新读取并注册：

- 读 `locale` 设置行的 `preference`，从 `{ 语言ID: 文本 }` 里选：先精确匹配完整 ID，再匹配主语言子标签（如 `en-US` → `en`），最后取第一条非空文本。
- 选词逻辑不写死任何语言，语言 ID 由文件名决定，数量不限。
- 目录里没有匹配文件、或 `pack` 为 `false` 时不注册 section，等同未安装。

宿主 realm 没有 `locale/change` 事件，语言真值来自 `locale.preference`（DSH 会把客户端 active 语言桥接回写此字段）。

## 配置

插件行提供一个 `config.pack` 指向 TXT 目录：

```yaml
- insert:
    - id: prompt-loader
      name: 'dsh-prompt-loader'
      config:
        pack:
          name: 'assistant:persona'
          order: 101
          complete: false
          dir: !!js >-
            process.getBuiltinModule('node:path').join(
              process.getBuiltinModule('node:path').dirname(
                process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('<your-package>/package.json')
              ),
              'content/prompts'
            )
```

目录示例：

```
content/prompts/
├── zh.txt          # 中文提示词正文
├── en.txt          # English prompt text
└── ja.txt          # 新增语言：丢一个文件即可
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `pack.dir` | `string` | （可选） | TXT 目录，文件名 = 语言 ID |
| `pack.ext` | `string` | `.txt` | 文件扩展名 |
| `pack.texts` | `Record<string, string>` | （可选） | 按语言 ID 提供的内联提示词映射，同名语言覆盖 `pack.dir`，支持通过设置页在线编辑 |
| `pack.name` | `string` | `injected:prompt` | section 名（同 scope 内唯一） |
| `pack.order` | `number` | `50` | 排序（人格段 0，工具段 100–199） |
| `pack.complete` | `boolean` | `false` | 为 true 时取代全部其他 section |

把 `pack` 设为 `false`（或省略）时不注入。

`config.pack` 声明为 `volatile()`：插件不持有持久用户设置，也不把配置写回。TXT 文件是唯一文案来源，改文案直接改文件。

## 设计说明

- **正文在文件里。** 插件不含任何提示词措辞，全部来自 `pack.dir` 下的 TXT。
- **语言可扩展。** 文件名即语言 ID，数量不限；选取按"精确 → 主子标签 → 首值"兜底，新增语言是纯文件改动。
- **干净的生命周期。** section 在 effect 内注册，清理或配置变化时先注销再注册，目录监听器也会一并释放，不留残余。

## 安装

```powershell
dsh plugin --profile desktop add dsh-prompt-loader
```

或在 profile 依赖中加入 `"dsh-prompt-loader": "0.1.0"`，并按上面方式提供配置行。

## 许可

MIT
