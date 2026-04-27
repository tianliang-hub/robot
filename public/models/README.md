# 模型放置规范

把下载好的模型按下面结构放置（推荐 `glb`）：

- `public/models/chef/chef.glb`
- `public/models/waiter/waiter.glb`
- `public/models/tables/table_1.glb`
- `public/models/tables/table_2.glb`
- `public/models/props/transfer_zone.glb`
- `public/models/props/recycle_bin.glb`
- `public/models/environment/restaurant_base.glb`（可选）

在 `main.js` 中可以通过绝对路径加载，例如：

- `/models/chef/chef.glb`
- `/models/waiter/waiter.glb`

注意事项：

1. 优先下载 `glb` 单文件格式，避免贴图丢失。
2. 文件名尽量全小写、下划线命名。
3. 如果暂时没有某个模型，可以先不放；保留占位体也能运行。
