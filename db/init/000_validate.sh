#!/bin/sh
# The official PostgreSQL entrypoint sources non-executable .sh files.
# A subshell keeps our shell options/exit local when this file is sourced.
(
    set -eu

    case "${DEMO_DATA:-no}" in
        yes) ;;
        *)
            printf '[init] DEMO_DATA="%s": demo data disabled (only "yes" enables it).\n' \
                "${DEMO_DATA:-no}" >&2
            ;;
    esac
)
