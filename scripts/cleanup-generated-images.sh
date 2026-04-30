#!/usr/bin/env bash

set -u -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"

IMAGE_DIR="${IMAGE_DIR:-$PROJECT_DIR/generated-images}"
RETENTION_DAYS="${RETENTION_DAYS:-3}"
LOG_FILE="${LOG_FILE:-/var/log/gpt-image-2-webui/cleanup-generated-images.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/gpt-image-2-webui-cleanup-generated-images.lock}"
DRY_RUN="${DRY_RUN:-0}"

RUN_REQUESTED=0
MENU_REQUESTED=0
HAD_ARGS=$#

CRON_MARKER_BEGIN="# gpt-image-playground generated-images cleanup begin"
CRON_MARKER_END="# gpt-image-playground generated-images cleanup end"

usage() {
    cat <<'EOF'
用法: cleanup-generated-images.sh [选项]

不带参数直接执行时，会进入交互菜单。
带参数执行时，会直接按参数清理，适合 cron 等定时任务调用。

常用示例:
  ./cleanup-generated-images.sh
  ./cleanup-generated-images.sh --run --image-dir ./generated-images --retention-days 3
  ./cleanup-generated-images.sh --run --image-dir ./generated-images --retention-days 3 --dry-run

选项:
  --menu                   进入交互菜单。
  --run                    直接执行清理，不进入菜单。
  --image-dir DIR          需要清理的图片目录。
  --retention-days DAYS    已生成图片的保留天数。默认值: 3。
  --log-file FILE          日志文件路径。
  --lock-file FILE         锁文件路径。
  --dry-run                仅记录将被删除的文件，不实际删除。
  -h, --help               显示此帮助信息。

环境变量:
  IMAGE_DIR, RETENTION_DAYS, LOG_FILE, LOCK_FILE, DRY_RUN=1
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --menu)
            MENU_REQUESTED=1
            shift
            ;;
        --run)
            RUN_REQUESTED=1
            shift
            ;;
        --image-dir)
            if [[ $# -lt 2 ]]; then
                echo "--image-dir 需要提供一个值。" >&2
                exit 2
            fi
            IMAGE_DIR="${2:-}"
            shift 2
            ;;
        --retention-days)
            if [[ $# -lt 2 ]]; then
                echo "--retention-days 需要提供一个值。" >&2
                exit 2
            fi
            RETENTION_DAYS="${2:-}"
            shift 2
            ;;
        --log-file)
            if [[ $# -lt 2 ]]; then
                echo "--log-file 需要提供一个值。" >&2
                exit 2
            fi
            LOG_FILE="${2:-}"
            shift 2
            ;;
        --lock-file)
            if [[ $# -lt 2 ]]; then
                echo "--lock-file 需要提供一个值。" >&2
                exit 2
            fi
            LOCK_FILE="${2:-}"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "未知选项: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

validate_config() {
    if [[ -z "$IMAGE_DIR" || -z "$LOG_FILE" || -z "$LOCK_FILE" ]]; then
        echo "IMAGE_DIR、LOG_FILE 和 LOCK_FILE 不能为空。" >&2
        return 2
    fi

    if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || ((RETENTION_DAYS < 1)); then
        echo "RETENTION_DAYS 必须是正整数。" >&2
        return 2
    fi
}

setup_logging() {
    if ! mkdir -p "$(dirname "$LOG_FILE")"; then
        echo "创建日志目录失败: $(dirname "$LOG_FILE")" >&2
        return 1
    fi

    if [[ -t 1 ]]; then
        exec > >(tee -a "$LOG_FILE") 2>&1
    else
        exec >>"$LOG_FILE" 2>&1
    fi
}

log() {
    printf '[%(%Y-%m-%dT%H:%M:%S%z)T] %s\n' -1 "$*"
}

format_epoch_ms() {
    local epoch_ms="$1"
    local epoch_seconds=$((10#$epoch_ms / 1000))

    date -d "@$epoch_seconds" '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null ||
        date -r "$epoch_seconds" '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null ||
        printf '%s' "$epoch_seconds"
}

run_cleanup() {
    validate_config || return $?
    setup_logging || return $?

    if command -v flock >/dev/null 2>&1; then
        exec 9>"$LOCK_FILE"
        if ! flock -n 9; then
            log "已有其他清理进程正在运行，退出。"
            return 0
        fi
    else
        LOCK_DIR="${LOCK_FILE}.d"
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            log "已有其他清理进程正在运行，退出。"
            return 0
        fi
        trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
    fi

    log "清理开始。图片目录=$IMAGE_DIR 保留天数=$RETENTION_DAYS 试运行=$DRY_RUN"

    if [[ ! -d "$IMAGE_DIR" ]]; then
        log "图片目录不存在，无需清理: $IMAGE_DIR"
        return 0
    fi

    now_seconds="$(date +%s)"
    retention_seconds=$((RETENTION_DAYS * 24 * 60 * 60))
    cutoff_ms=$(((now_seconds - retention_seconds) * 1000))

    processed=0
    kept=0
    deleted=0
    would_delete=0
    skipped=0
    failed=0

    while IFS= read -r -d '' file; do
        base_name="$(basename "$file")"
        ((processed += 1))

        if [[ ! "$base_name" =~ ^([0-9]{13})-[0-9]+\.(png|jpg|jpeg|webp)$ ]]; then
            ((skipped += 1))
            log "跳过不匹配命名规则的文件: $base_name"
            continue
        fi

        created_ms="${BASH_REMATCH[1]}"
        created_at="$(format_epoch_ms "$created_ms")"

        if ((10#$created_ms > cutoff_ms)); then
            ((kept += 1))
            continue
        fi

        if [[ "$DRY_RUN" == "1" ]]; then
            ((would_delete += 1))
            log "试运行，将删除: $base_name 创建时间=$created_at"
            continue
        fi

        if rm -f -- "$file"; then
            ((deleted += 1))
            log "已删除: $base_name 创建时间=$created_at"
        else
            ((failed += 1))
            log "删除失败: $base_name 创建时间=$created_at"
        fi
    done < <(find "$IMAGE_DIR" -maxdepth 1 -type f -print0)

    log "清理完成。已处理=$processed 已保留=$kept 已删除=$deleted 试运行将删除=$would_delete 已跳过=$skipped 失败=$failed"

    if ((failed > 0)); then
        return 1
    fi
}

pause_menu() {
    printf '\n按 Enter 返回菜单...'
    read -r _
}

prompt_with_default() {
    local prompt="$1"
    local current_value="$2"
    local answer

    printf '%s [%s]: ' "$prompt" "$current_value" >&2
    read -r answer
    if [[ -n "$answer" ]]; then
        printf '%s' "$answer"
    else
        printf '%s' "$current_value"
    fi
}

prompt_positive_integer() {
    local prompt="$1"
    local current_value="$2"
    local answer

    while true; do
        answer="$(prompt_with_default "$prompt" "$current_value")"
        if [[ "$answer" =~ ^[0-9]+$ ]] && ((10#$answer >= 1)); then
            printf '%s' "$answer"
            return 0
        fi
        echo "请输入正整数。" >&2
    done
}

show_current_config() {
    cat <<EOF
当前配置:
  图片目录: $IMAGE_DIR
  保留天数: $RETENTION_DAYS
  日志文件: $LOG_FILE
  锁文件:   $LOCK_FILE
EOF
}

configure_menu_values() {
    echo
    echo "修改本次配置，直接回车保留当前值。"
    IMAGE_DIR="$(prompt_with_default "图片目录" "$IMAGE_DIR")"
    RETENTION_DAYS="$(prompt_positive_integer "保留天数" "$RETENTION_DAYS")"
    echo
    LOG_FILE="$(prompt_with_default "日志文件" "$LOG_FILE")"
    LOCK_FILE="$(prompt_with_default "锁文件" "$LOCK_FILE")"
    echo
    show_current_config
}

ensure_cron_available() {
    if ! command -v crontab >/dev/null 2>&1; then
        echo "当前系统找不到 crontab 命令，无法管理 cron 定时任务。" >&2
        return 1
    fi
}

build_cron_command() {
    local quoted_script quoted_image_dir quoted_log_file quoted_lock_file

    printf -v quoted_script '%q' "$SCRIPT_PATH"
    printf -v quoted_image_dir '%q' "$IMAGE_DIR"
    printf -v quoted_log_file '%q' "$LOG_FILE"
    printf -v quoted_lock_file '%q' "$LOCK_FILE"

    printf 'bash %s --run --image-dir %s --retention-days %s --log-file %s --lock-file %s' \
        "$quoted_script" "$quoted_image_dir" "$RETENTION_DAYS" "$quoted_log_file" "$quoted_lock_file"
}

remove_marked_cron_block() {
    awk -v begin="$CRON_MARKER_BEGIN" -v end="$CRON_MARKER_END" '
        $0 == begin {skip = 1; next}
        $0 == end {skip = 0; next}
        !skip {print}
    '
}

add_cron_job() {
    ensure_cron_available || return 1

    echo
    echo "添加或更新 cron 定时任务。"
    echo "默认是每天凌晨 3 点执行一次: 0 3 * * *"
    echo "如果不熟悉 cron 表达式，直接回车使用默认值。"
    echo

    configure_menu_values

    local schedule cron_command existing_cron
    schedule="$(prompt_with_default "cron 时间表达式" "0 3 * * *")"
    cron_command="$(build_cron_command)"
    existing_cron="$(crontab -l 2>/dev/null || true)"

    {
        printf '%s\n' "$existing_cron" | remove_marked_cron_block
        printf '\n%s\n' "$CRON_MARKER_BEGIN"
        printf '%s %s\n' "$schedule" "$cron_command"
        printf '%s\n' "$CRON_MARKER_END"
    } | crontab -

    if [[ $? -eq 0 ]]; then
        echo
        echo "定时任务已添加或更新。"
        echo "$schedule $cron_command"
    else
        echo "写入 crontab 失败。" >&2
        return 1
    fi
}

remove_cron_job() {
    ensure_cron_available || return 1

    local existing_cron
    existing_cron="$(crontab -l 2>/dev/null || true)"

    if ! printf '%s\n' "$existing_cron" | grep -Fxq "$CRON_MARKER_BEGIN"; then
        echo "没有找到由本脚本添加的定时任务。"
        return 0
    fi

    printf '%s\n' "$existing_cron" | remove_marked_cron_block | crontab -
    if [[ $? -eq 0 ]]; then
        echo "定时任务已删除。"
    else
        echo "删除定时任务失败。" >&2
        return 1
    fi
}

show_cron_job() {
    ensure_cron_available || return 1

    local existing_cron
    existing_cron="$(crontab -l 2>/dev/null || true)"

    if ! printf '%s\n' "$existing_cron" | grep -Fxq "$CRON_MARKER_BEGIN"; then
        echo "没有找到由本脚本添加的定时任务。"
        return 0
    fi

    printf '%s\n' "$existing_cron" | awk -v begin="$CRON_MARKER_BEGIN" -v end="$CRON_MARKER_END" '
        $0 == begin {show = 1; print; next}
        $0 == end {print; show = 0; next}
        show {print}
    '
}

show_recent_log() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "日志文件还不存在: $LOG_FILE"
        return 0
    fi

    tail -n 100 "$LOG_FILE"
}

run_cleanup_from_menu() {
    local dry_run_value="$1"
    (
        DRY_RUN="$dry_run_value"
        run_cleanup
    )
}

run_menu() {
    while true; do
        echo
        echo "=============================="
        echo "生成图片清理脚本菜单"
        echo "=============================="
        show_current_config
        cat <<'EOF'

请选择操作:
  1) 试运行清理，只看将删除哪些文件
  2) 立即正式清理
  3) 修改本次配置
  4) 添加或更新 cron 定时任务
  5) 查看 cron 定时任务
  6) 删除 cron 定时任务
  7) 查看最近 100 行日志
  8) 显示帮助
  0) 退出
EOF
        printf '请输入选项: '
        read -r choice

        case "$choice" in
            1)
                run_cleanup_from_menu 1
                pause_menu
                ;;
            2)
                printf '确认正式删除过期图片吗？输入 yes 继续: '
                read -r confirm
                if [[ "$confirm" == "yes" ]]; then
                    run_cleanup_from_menu 0
                else
                    echo "已取消正式清理。"
                fi
                pause_menu
                ;;
            3)
                configure_menu_values
                pause_menu
                ;;
            4)
                add_cron_job
                pause_menu
                ;;
            5)
                show_cron_job
                pause_menu
                ;;
            6)
                printf '确认删除由本脚本添加的 cron 定时任务吗？输入 yes 继续: '
                read -r confirm
                if [[ "$confirm" == "yes" ]]; then
                    remove_cron_job
                else
                    echo "已取消删除定时任务。"
                fi
                pause_menu
                ;;
            7)
                show_recent_log
                pause_menu
                ;;
            8)
                usage
                pause_menu
                ;;
            0)
                echo "已退出。"
                return 0
                ;;
            *)
                echo "未知选项，请重新输入。"
                pause_menu
                ;;
        esac
    done
}

if ((MENU_REQUESTED == 1)); then
    run_menu
    exit $?
fi

if ((RUN_REQUESTED == 1 || HAD_ARGS > 0)); then
    run_cleanup
    exit $?
fi

if [[ -t 0 && -t 1 ]]; then
    run_menu
else
    run_cleanup
fi
