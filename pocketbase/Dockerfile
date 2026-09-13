FROM alpine:3.21

ARG POCKETBASE_VERSION=0.40.4

RUN apk add --no-cache ca-certificates unzip wget \
    && wget -q -O /tmp/pocketbase.zip \
        "https://github.com/pocketbase/pocketbase/releases/download/v0.40.4/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
    && unzip /tmp/pocketbase.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/pocketbase \
    && rm /tmp/pocketbase.zip

WORKDIR /pb

COPY pocketbase/pb_migrations ./pb_migrations
COPY pocketbase/docker-entrypoint.sh ./docker-entrypoint.sh
COPY index.html logic.js styles.css offline_manager.js ./pb_public/

RUN chmod +x ./docker-entrypoint.sh

VOLUME ["/pb/pb_data"]

EXPOSE 8090

ENTRYPOINT ["./docker-entrypoint.sh"]
