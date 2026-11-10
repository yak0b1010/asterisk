#!/bin/sh
# Safe both when sourced by postgres's entrypoint and when executed.
(
    set -eu

    case "${DEMO_DATA:-no}" in
        yes)
            : "${POSTGRES_USER:?POSTGRES_USER is required}"
            : "${POSTGRES_DB:?POSTGRES_DB is required}"
            printf '%s\n' '[init] DEMO_DATA=yes: loading demonstration PBX data'
            psql -X --no-password --set=ON_ERROR_STOP=1 \
                --username "$POSTGRES_USER" \
                --dbname "$POSTGRES_DB" \
                --file /docker-entrypoint-initdb.d/seed/demo.sql
            ;;
        *)
            printf '[init] DEMO_DATA="%s": no demo PBX objects seeded\n' \
                "${DEMO_DATA:-no}"
            ;;
    esac
)
