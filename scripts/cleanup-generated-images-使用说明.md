# 生成图片清理脚本使用说明

本文档说明 `cleanup-generated-images.sh` 的用途、运行方式、参数含义、推荐配置、定时执行方式以及常见问题处理。这个脚本用于清理项目生成图片目录中的过期图片，适合部署在服务器、WSL、Linux、macOS 或带有 Bash 环境的 Windows 机器上运行。

脚本位置：

```bash
scripts/cleanup-generated-images.sh
```

默认清理目录：

```bash
generated-images
```

默认保留时间：

```bash
3 天
```

默认日志文件：

```bash
/var/log/gpt-image-2-webui/cleanup-generated-images.log
```

默认锁文件：

```bash
/tmp/gpt-image-2-webui-cleanup-generated-images.lock
```

## 一、这个脚本是做什么的

项目运行时会生成图片文件，这些文件通常会保存在 `generated-images` 目录里。随着使用时间变长，图片会不断累积，占用磁盘空间。`cleanup-generated-images.sh` 的作用就是定期删除超过保留期限的生成图片，避免磁盘被历史图片占满。

脚本会读取图片文件名中的时间戳，根据时间戳判断图片是否过期。默认情况下，脚本会保留最近 3 天生成的图片，删除 3 天以前的图片。

它不会递归清理子目录，只会清理指定图片目录第一层中的普通文件。

它也不会删除所有文件，只会处理符合命名规则的图片文件。

## 二、脚本会删除哪些文件

脚本只会删除符合以下命名规则的文件：

```text
13位毫秒时间戳-数字.扩展名
```

支持的图片扩展名：

```text
png
jpg
jpeg
webp
```

示例：

```text
1714380000000-1.png
1714380000000-2.jpg
1714380000000-3.jpeg
1714380000000-4.webp
```

其中 `1714380000000` 是 13 位毫秒时间戳。脚本会把它转换成秒级时间，再与当前时间和保留天数计算出的截止时间进行比较。

不会被清理的文件示例：

```text
test.png
avatar.jpg
1714380000000.png
1714380000000-demo.png
1714380000000-1.gif
readme.txt
```

这些文件会被记录为“跳过不匹配命名规则的文件”。这样设计可以降低误删风险，避免脚本把目录里其他手动放进去的文件一起删除。

## 三、脚本的基本运行方式

现在脚本支持两种使用方式：

```text
不带参数执行：进入交互菜单，可以选择试运行、正式清理、添加定时任务、删除定时任务等操作。
带参数执行：直接按参数清理，适合 cron、systemd timer 等定时任务调用。
```

在项目根目录进入交互菜单：

```bash
bash scripts/cleanup-generated-images.sh
```

如果脚本有执行权限，也可以这样运行：

```bash
./scripts/cleanup-generated-images.sh
```

如果提示没有执行权限，可以先加权限：

```bash
chmod +x scripts/cleanup-generated-images.sh
```

然后再执行：

```bash
./scripts/cleanup-generated-images.sh
```

菜单里可以选择：

```text
1) 试运行清理，只看将删除哪些文件
2) 立即正式清理
3) 修改本次配置
4) 添加或更新 cron 定时任务
5) 查看 cron 定时任务
6) 删除 cron 定时任务
7) 查看最近 100 行日志
8) 显示帮助
0) 退出
```

如果你想跳过菜单、直接执行清理，需要加 `--run`，例如：

```bash
bash scripts/cleanup-generated-images.sh --run
```

在 Windows 上，如果你使用 Git Bash，可以进入项目目录后执行：

```bash
bash scripts/cleanup-generated-images.sh
```

在 Windows PowerShell 中直接运行 `.sh` 文件通常不合适，建议通过 Git Bash、WSL 或服务器上的 Bash 环境运行。

## 四、先用试运行确认将删除哪些文件

正式删除前，强烈建议先使用 `--dry-run` 试运行。

试运行不会真正删除文件，只会把“如果正式运行会删除哪些文件”写入日志。

最简单的方式是直接进入菜单，然后选 `1`：

```bash
./scripts/cleanup-generated-images.sh
```

如果想用命令行直接试运行：

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run
```

你也可以指定图片目录后试运行：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --dry-run
```

试运行日志示例：

```text
[2026-04-30T12:00:00+0800] 清理开始。图片目录=/path/to/project/generated-images 保留天数=3 试运行=1
[2026-04-30T12:00:00+0800] 试运行，将删除: 1714380000000-1.png 创建时间=2024-04-29 12:00:00 +0800
[2026-04-30T12:00:00+0800] 清理完成。已处理=10 已保留=8 已删除=0 试运行将删除=2 已跳过=0 失败=0
```

确认日志中的待删除文件符合预期后，再去掉 `--dry-run` 正式执行。

## 五、正式清理

最简单的方式是直接进入菜单，然后选 `2`：

```bash
./scripts/cleanup-generated-images.sh
```

如果想用命令行直接正式清理，需要加 `--run`。

默认配置下正式清理：

```bash
bash scripts/cleanup-generated-images.sh --run
```

指定保留 7 天：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 7
```

指定图片目录：

```bash
bash scripts/cleanup-generated-images.sh --run --image-dir /path/to/generated-images
```

指定日志文件：

```bash
bash scripts/cleanup-generated-images.sh --run --log-file /tmp/cleanup-generated-images.log
```

完整示例：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir /opt/gpt-image-playground/generated-images \
  --retention-days 3 \
  --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

## 六、命令行参数说明

### `--menu`

进入交互菜单。

示例：

```bash
bash scripts/cleanup-generated-images.sh --menu
```

不带任何参数直接执行时，也会进入交互菜单。

### `--run`

直接执行清理，不进入交互菜单。

这个参数特别适合 cron 或 systemd timer，因为定时任务不能停下来等待你在菜单里输入选项。

示例：

```bash
bash scripts/cleanup-generated-images.sh --run
```

### `--image-dir DIR`

指定要清理的图片目录。

默认值是项目根目录下的 `generated-images`：

```bash
generated-images
```

示例：

```bash
bash scripts/cleanup-generated-images.sh --run --image-dir ./generated-images
```

如果部署目录是 `/opt/gpt-image-playground`，可以这样写：

```bash
bash /opt/gpt-image-playground/scripts/cleanup-generated-images.sh \
  --run \
  --image-dir /opt/gpt-image-playground/generated-images
```

如果指定的目录不存在，脚本不会报错删除其他路径，而是记录日志后退出：

```text
图片目录不存在，无需清理: /path/to/generated-images
```

### `--retention-days DAYS`

指定图片保留天数。

默认值：

```bash
3
```

示例：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 1
```

这表示只保留最近 1 天内生成的图片，超过 1 天的符合命名规则的图片会被删除。

再比如：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 30
```

这表示保留最近 30 天的图片。

`RETENTION_DAYS` 必须是正整数，不能是 `0`、负数、小数或空值。

错误示例：

```bash
bash scripts/cleanup-generated-images.sh --retention-days 0
bash scripts/cleanup-generated-images.sh --retention-days -1
bash scripts/cleanup-generated-images.sh --retention-days 1.5
```

这些都会被脚本拒绝。

### `--log-file FILE`

指定日志文件路径。

默认值：

```bash
/var/log/gpt-image-2-webui/cleanup-generated-images.log
```

示例：

```bash
bash scripts/cleanup-generated-images.sh --run --log-file ./cleanup-generated-images.log
```

如果是在普通用户环境运行，可能没有权限写入 `/var/log`。这时可以把日志放到项目目录或用户目录：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --log-file ./logs/cleanup-generated-images.log
```

或：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --log-file "$HOME/cleanup-generated-images.log"
```

脚本会自动创建日志文件所在目录。如果目录创建失败，脚本会退出并提示：

```text
创建日志目录失败: 日志目录路径
```

### `--dry-run`

试运行模式。

启用后不会删除任何文件，只会记录哪些文件在正式运行时会被删除。

示例：

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run
```

建议每次修改清理目录或保留天数后，都先用 `--dry-run` 看一遍日志。

### `-h` 或 `--help`

显示帮助信息。

```bash
bash scripts/cleanup-generated-images.sh --help
```

## 七、环境变量方式

除了命令行参数，脚本也支持通过环境变量配置。

支持的环境变量：

```bash
IMAGE_DIR
RETENTION_DAYS
LOG_FILE
LOCK_FILE
DRY_RUN
```

示例：

```bash
IMAGE_DIR=/opt/gpt-image-playground/generated-images \
RETENTION_DAYS=7 \
LOG_FILE=/var/log/gpt-image-2-webui/cleanup-generated-images.log \
bash scripts/cleanup-generated-images.sh --run
```

启用试运行：

```bash
DRY_RUN=1 bash scripts/cleanup-generated-images.sh --run
```

指定锁文件：

```bash
LOCK_FILE=/tmp/my-cleanup.lock bash scripts/cleanup-generated-images.sh --run
```

命令行参数会覆盖脚本启动时的默认值。实际使用时，建议定时任务里把关键路径都写清楚，这样以后迁移目录或排查问题更直观。

## 八、日志怎么看

默认日志位置：

```bash
/var/log/gpt-image-2-webui/cleanup-generated-images.log
```

查看最后 100 行日志：

```bash
tail -n 100 /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

实时查看日志：

```bash
tail -f /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

日志中常见字段说明：

```text
已处理       本次扫描到的文件数量
已保留       符合命名规则但还没过期的文件数量
已删除       正式运行时成功删除的文件数量
试运行将删除 试运行模式下预计会删除的文件数量
已跳过       不符合命名规则而跳过的文件数量
失败         删除失败的文件数量
```

示例：

```text
清理完成。已处理=120 已保留=95 已删除=20 试运行将删除=0 已跳过=5 失败=0
```

这表示本次扫描了 120 个文件，其中 95 个还在保留期内，20 个已过期并成功删除，5 个因为命名不符合规则被跳过，没有删除失败。

## 九、推荐使用流程

第一次使用建议按这个顺序来：

1. 查看帮助信息。

```bash
bash scripts/cleanup-generated-images.sh --help
```

2. 先试运行，确认将删除哪些文件。

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run
```

3. 查看日志。

```bash
tail -n 100 /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

4. 如果日志路径没有权限，改用项目内日志。

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --log-file ./logs/cleanup-generated-images.log \
  --dry-run
```

5. 确认无误后正式清理。

```bash
bash scripts/cleanup-generated-images.sh --run
```

6. 配置定时任务，让它每天自动运行。

## 十、使用 cron 定时执行

如果部署在 Linux 服务器上，推荐使用 cron 每天执行一次。

现在脚本可以直接帮你添加 cron 定时任务。最简单的方式是运行脚本进入菜单：

```bash
./scripts/cleanup-generated-images.sh
```

然后选择：

```text
4) 添加或更新 cron 定时任务
```

脚本会让你确认图片目录、保留天数、日志文件、锁文件和 cron 时间表达式。默认 cron 时间表达式是：

```cron
0 3 * * *
```

表示每天凌晨 3 点执行一次。

如果要删除脚本添加的定时任务，重新进入菜单，选择：

```text
6) 删除 cron 定时任务
```

如果要查看当前定时任务，选择：

```text
5) 查看 cron 定时任务
```

脚本添加的 cron 任务会带有标记：

```text
# gpt-image-playground generated-images cleanup begin
# gpt-image-playground generated-images cleanup end
```

删除时只会删除这两个标记之间的任务，不会删除你自己手动添加的其他 cron 任务。

你也可以手动编辑 cron。

编辑当前用户的 crontab：

```bash
crontab -e
```

每天凌晨 3 点执行一次：

```cron
0 3 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

如果普通用户没有 `/var/log` 写入权限，可以把日志放到项目目录：

```cron
0 3 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /opt/gpt-image-playground/logs/cleanup-generated-images.log
```

如果想每 6 小时执行一次：

```cron
0 */6 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /opt/gpt-image-playground/logs/cleanup-generated-images.log
```

如果想先定时试运行观察一天：

```cron
0 3 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /opt/gpt-image-playground/logs/cleanup-generated-images.log --dry-run
```

观察确认无误后，再删除 `--dry-run`。

## 十一、使用 systemd timer 定时执行

如果你的服务器使用 systemd，也可以用 `service + timer` 的方式管理定时任务。好处是日志和状态更容易查看，也更适合生产环境。

创建服务文件：

```bash
sudo nano /etc/systemd/system/gpt-image-cleanup.service
```

内容示例：

```ini
[Unit]
Description=清理 gpt-image-playground 生成图片

[Service]
Type=oneshot
WorkingDirectory=/opt/gpt-image-playground
ExecStart=/usr/bin/bash /opt/gpt-image-playground/scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

创建定时器文件：

```bash
sudo nano /etc/systemd/system/gpt-image-cleanup.timer
```

内容示例：

```ini
[Unit]
Description=每天定时清理 gpt-image-playground 生成图片

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

重新加载 systemd 配置：

```bash
sudo systemctl daemon-reload
```

启动并启用定时器：

```bash
sudo systemctl enable --now gpt-image-cleanup.timer
```

查看定时器状态：

```bash
systemctl status gpt-image-cleanup.timer
```

查看最近执行记录：

```bash
journalctl -u gpt-image-cleanup.service -n 100 --no-pager
```

手动执行一次服务：

```bash
sudo systemctl start gpt-image-cleanup.service
```

如果要先试运行，可以临时把 `ExecStart` 末尾加上 `--dry-run`，观察日志确认后再删除。

## 十二、在 Windows 上使用

这个脚本是 Bash 脚本，不建议直接在 PowerShell 中当作 PowerShell 脚本执行。

推荐方式有三种：

1. Git Bash
2. WSL
3. 部署到 Linux 服务器后运行

### Git Bash 手动执行

打开 Git Bash，进入项目目录：

```bash
cd /d/Work/AI-Project/gpt-image-playground
```

试运行：

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run --log-file ./logs/cleanup-generated-images.log
```

正式运行：

```bash
bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log
```

### WSL 手动执行

如果项目位于 Windows 的 D 盘，在 WSL 中路径通常是：

```bash
/mnt/d/Work/AI-Project/gpt-image-playground
```

进入项目目录：

```bash
cd /mnt/d/Work/AI-Project/gpt-image-playground
```

试运行：

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run --log-file ./logs/cleanup-generated-images.log
```

正式运行：

```bash
bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log
```

### Windows 任务计划程序

如果想在 Windows 上定时执行，建议让任务计划程序调用 Git Bash 或 WSL。

Git Bash 的思路是让任务计划程序运行 `bash.exe`，并把脚本路径作为参数传进去。具体路径取决于你的 Git 安装位置，常见位置类似：

```text
C:\Program Files\Git\bin\bash.exe
```

任务参数可以类似这样：

```text
-lc "cd /d/Work/AI-Project/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log"
```

如果使用 WSL，任务计划程序可以调用：

```text
wsl.exe
```

参数类似：

```text
bash -lc "cd /mnt/d/Work/AI-Project/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log"
```

Windows 环境下更建议把日志写到项目目录，例如：

```bash
./logs/cleanup-generated-images.log
```

这样比写 `/var/log` 更容易查看，也能避免权限问题。

## 十三、锁文件的作用

脚本通过锁文件防止多个清理进程同时运行。

默认锁文件：

```bash
/tmp/gpt-image-2-webui-cleanup-generated-images.lock
```

如果系统支持 `flock`，脚本会使用 `flock` 加锁。如果系统没有 `flock`，脚本会退回到创建锁目录的方式：

```bash
/tmp/gpt-image-2-webui-cleanup-generated-images.lock.d
```

如果上一次清理还没结束，下一次清理启动时会记录：

```text
已有其他清理进程正在运行，退出。
```

这不是错误，表示脚本主动避免重复执行。

如果你有多个项目实例，并且它们的图片目录不同，建议给不同实例配置不同的 `LOCK_FILE`，避免互相影响。

示例：

```bash
LOCK_FILE=/tmp/gpt-image-playground-instance-a-cleanup.lock \
bash scripts/cleanup-generated-images.sh --run
```

## 十四、退出码说明

脚本退出码可以用于定时任务或监控判断执行结果。

常见退出码：

```text
0  执行成功，或者没有需要清理的内容
1  有文件删除失败，或者日志目录创建失败
2  参数错误，例如缺少参数值、保留天数不是正整数、未知选项
```

如果日志中出现 `失败=0`，通常说明清理任务正常完成。

如果日志中出现 `失败` 大于 0，需要检查文件权限、目录权限、文件是否被占用等问题。

## 十五、安全注意事项

这个脚本会执行删除操作，所以正式使用前请注意以下几点：

1. 第一次使用一定先跑 `--dry-run`。
2. 确认 `--image-dir` 指向的是生成图片目录，不要指向项目根目录或其他重要目录。
3. 保留天数不要设置得过短，除非你确定生成图片不需要长期访问。
4. 日志路径建议固定下来，方便以后排查。
5. 如果部署在服务器上，建议使用绝对路径，不要依赖当前所在目录。
6. 定时任务上线前，先手动执行一次确认效果。

推荐的生产命令示例：

```bash
cd /opt/gpt-image-playground && \
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir /opt/gpt-image-playground/generated-images \
  --retention-days 3 \
  --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

推荐的本地 Windows/Git Bash 命令示例：

```bash
cd /d/Work/AI-Project/gpt-image-playground && \
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log
```

## 十六、常见问题

### 1. 运行后没有删除任何图片

先看日志结尾：

```bash
tail -n 100 ./logs/cleanup-generated-images.log
```

可能原因：

```text
图片还没有超过保留天数。
图片文件名不符合 13位毫秒时间戳-数字.扩展名 的规则。
指定的 --image-dir 不是实际图片目录。
运行时使用了 --dry-run，所以不会实际删除。
```

可以先用 1 天保留期试运行观察：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 1 --dry-run --log-file ./logs/cleanup-generated-images.log
```

### 2. 日志里有很多“跳过不匹配命名规则的文件”

这表示这些文件名不符合脚本的清理规则。例如：

```text
test.png
demo.webp
abc.jpg
```

脚本不会删除这些文件。这样可以避免误删。若这些文件也需要清理，需要先确认它们是否真的属于生成图片，再考虑修改脚本规则。

### 3. 提示创建日志目录失败

例如：

```text
创建日志目录失败: /var/log/gpt-image-2-webui
```

通常是当前用户没有权限写入 `/var/log`。

解决办法一：使用 `sudo` 运行。

```bash
sudo bash scripts/cleanup-generated-images.sh --run
```

解决办法二：把日志写到项目目录。

```bash
bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log
```

本地开发环境更推荐第二种。

### 4. 提示 `RETENTION_DAYS 必须是正整数`

说明保留天数参数不合法。

正确写法：

```bash
--retention-days 3
```

错误写法：

```bash
--retention-days 0
--retention-days -3
--retention-days 1.5
--retention-days abc
```

### 5. 提示已有其他清理进程正在运行

日志内容：

```text
已有其他清理进程正在运行，退出。
```

这说明同一时间已经有一个清理任务在执行。通常不用处理，等待下一次定时任务即可。

如果你确认没有清理任务在运行，但一直出现这个提示，可能是使用锁目录兜底方案时遗留了锁目录。先确认没有进程在运行，再检查锁目录：

```bash
ls -ld /tmp/gpt-image-2-webui-cleanup-generated-images.lock.d
```

确认无运行中的清理进程后，可以删除遗留锁目录：

```bash
rmdir /tmp/gpt-image-2-webui-cleanup-generated-images.lock.d
```

如果系统使用的是 `flock` 锁文件，通常不会有这种问题，因为进程退出后锁会自动释放。

### 6. Windows 上看到中文乱码

如果在 PowerShell 里查看中文日志或文档出现乱码，通常是终端编码问题，不一定是文件内容错误。

可以尝试在 PowerShell 中切换 UTF-8：

```powershell
chcp 65001
```

也可以用支持 UTF-8 的编辑器查看，例如 VS Code。

如果是 Git Bash 或 WSL，通常中文显示更稳定。

## 十七、建议配置

### 本地开发环境

本地开发环境建议：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log
```

第一次运行先加 `--dry-run`：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log \
  --dry-run
```

### 生产服务器

生产服务器建议使用绝对路径：

```bash
bash /opt/gpt-image-playground/scripts/cleanup-generated-images.sh \
  --run \
  --image-dir /opt/gpt-image-playground/generated-images \
  --retention-days 3 \
  --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

再配合 cron 或 systemd timer 每天执行一次。

### 图片访问量较大的环境

如果图片目录增长很快，可以缩短执行周期，例如每 6 小时执行一次，但保留天数仍然保持 3 天：

```cron
0 */6 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

### 需要长期留存图片的环境

如果图片需要保留更久，可以增加保留天数：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 30
```

也可以只手动运行，不配置定时任务。

## 十八、快速命令清单

查看帮助：

```bash
bash scripts/cleanup-generated-images.sh --help
```

试运行：

```bash
bash scripts/cleanup-generated-images.sh --run --dry-run
```

正式清理：

```bash
bash scripts/cleanup-generated-images.sh --run
```

保留 7 天：

```bash
bash scripts/cleanup-generated-images.sh --run --retention-days 7
```

指定日志到项目目录：

```bash
bash scripts/cleanup-generated-images.sh --run --log-file ./logs/cleanup-generated-images.log
```

指定图片目录、保留天数和日志路径：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log
```

查看日志：

```bash
tail -n 100 ./logs/cleanup-generated-images.log
```

实时查看日志：

```bash
tail -f ./logs/cleanup-generated-images.log
```

每天凌晨 3 点定时清理：

```cron
0 3 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /opt/gpt-image-playground/logs/cleanup-generated-images.log
```

## 十九、推荐最终落地方式

如果只是本地开发，推荐先使用：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log \
  --dry-run
```

确认日志没问题后，正式执行：

```bash
bash scripts/cleanup-generated-images.sh \
  --run \
  --image-dir ./generated-images \
  --retention-days 3 \
  --log-file ./logs/cleanup-generated-images.log
```

如果是服务器部署，推荐使用 cron：

```cron
0 3 * * * cd /opt/gpt-image-playground && bash scripts/cleanup-generated-images.sh --run --image-dir /opt/gpt-image-playground/generated-images --retention-days 3 --log-file /var/log/gpt-image-2-webui/cleanup-generated-images.log
```

这样每天凌晨自动清理一次，保留最近 3 天的生成图片，并把执行过程写入固定日志文件。
