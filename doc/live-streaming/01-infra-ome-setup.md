# 01. インフラ構築 — OvenMediaEngine (OME) セットアップ

## 0. この文書の位置づけ

本文書は Misskey fork 独自ライブ配信システム (「ライブチャンネル」機能) のうち、
**Phase 0: インフラ構築** の実行手順書である。読者は「実装を任される低レベル LLM
または初級エンジニア」を想定し、曖昧さゼロ・コピペで実行できる粒度で記述する。

対象範囲は OvenMediaEngine (OME) を PVE2 上に LXC + Docker で構築し、LAN 内で
OBS → OME (WHIP ingest) → 視聴 (OvenPlayer/デモページ) の疎通を実証するところまで。Misskey
backend 側の実装 (`core/live/` 等) は本文書の範囲外であり、別文書 (02 以降) で扱う。

### 前提 (読むべき文書)

- `doc/live-streaming/00-overview.md` — 機能全体の要件・アーキテクチャ決定・未確定
  事項の通し番号。本文書内の「⚠ 未確定事項 #N」は 00-overview.md の該当番号を指す。
  **本文書を読む前に 00-overview.md を読了していること。**
- 本文書は以下 3 件の調査/決定文書の内容を正本として反映している (差分があれば
  当該文書が優先):
  - `architecture-decisions.md` (アーキテクチャ決定、オーケストレーター確定版)
  - `research-ome.md` (OME 技術調査)
  - `research-infra.md` (PVE2 環境調査)

### 完了条件チェックリスト

Phase 0 は以下すべてが満たされた時点で完了とする。

- [x] PVE2 上に LXC (Debian 12 + Docker) が作成され、SSH 到達可能
- [x] OME コンテナが起動し、REST API (8081) が応答する
- [x] Server.xml に `live` アプリ、Bypass 出力プロファイル、Providers
      (WebRTC のみ)、Publishers (WebRTC のみ)、SignedPolicy (WHIP Provider 有効)、REST API
      AccessToken が設定されている (AdmissionWebhooks はオプションのため無効化したままで可、§4・§6(e) 参照)
- [x] OBS から WHIP ingest → REST API のストリーム一覧に反映されることを確認済み
- [x] OvenPlayer デモページ (または OME 同梱デモ) で WebRTC 再生を確認済み
- [x] `bitrateLatest`/`bitrateAvg` の実測値を記録済み (⚠ 未確定事項 #4 の検証結果を
      00-overview.md にフィードバックすること)
- [x] 3 種のシークレットを生成し、Server.xml と Misskey `default.yml` 双方に反映
      済み (本番反映は Phase 2 実装後)
- [x] WAN 公開は本文書 §7 のとおり **未実施** (人間承認待ち) であることを確認

---

## 1. 目的と構成図

目的: OBS 等のエンコーダから WebRTC(WHIP) で受けた映像・音声を無トランス
コード (Bypass) のまま WebRTC で視聴者に配信する基盤を、PVE2 上の独立
LXC に構築する。Misskey (mi-host) とは同一 vmbr0 上の LAN 直結とし、
配信認可は SignedPolicy (URL 署名検証) で完結する。AdmissionWebhooks は
将来拡張のためオプションとして残す。

```
                           ┌─────────────────────────────────────────┐
                           │              WAN (インターネット)          │
                           │  配信者(OBS)・視聴者ブラウザ (外部)         │
                           └───────────────┬───────────────────────┘
                                           │ ⚠ 人間承認後のみ (§7)
                                           │ ICE 10000-10009/udp, TURN 3478/tcp,
                                           │ signalling / WHIP は HAProxy 経由 wss
                           ┌───────────────▼───────────────────────┐
                           │  OPNsense (WAN境界)                      │
                           │  - NAT port forward (§7.2)               │
                           │  - HAProxy (signalling/WHIP のみ, is_ome_host) │
                           └───────────────┬───────────────────────┘
 ====================== LAN境界 (192.168.1.0/24, vmbr0) ======================
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │  PVE2 (物理ノード)                │                                 │
         │                                  │                                 │
         │  ┌───────────────────────┐      │      ┌───────────────────────┐ │
         │  │ mi-host (VM 200)       │      │      │ ome (LXC, 本文書で新設) │ │
         │  │ 192.168.1.104          │      │      │ 192.168.1.<DHCP_IP>    │ │
         │  │ Misskey backend :3000  │      │      │ Docker: OME container │ │
         │  │                        │      │      │ WS signalling:3333/3334│ │
         │  │                        │◄─────┼─────►│ REST API :8081 (統計/切断) │ │
         │  │ フロント (OvenPlayer/MkOmePlayer) │      │ SignedPolicy (URL署名検証) │ │
         │  │ ブラウザ視聴 (LAN内は直接到達)     │      │ TURN relay:3478/tcp    │ │
         │  │                        │      │      │ ICE:10000-10009/udp    │ │
         │  └───────────┬────────────┘      │      └────────────────────────┘ │
         │              │                    │                                 │
         └──────────────┼──────────────────────────────────────────────────┘
                         │ WebRTC (wss signalling + ICE UDP)
                         ▼
                 視聴者ブラウザ (LAN内)
```

凡例: OBS からの ingest 経路は WebRTC(WHIP) のみ `ome` LXC へ直接到達 (Bypass
のため転送処理のみ、トランスコードなし)。視聴は WebRTC のみ。配信認可は
SignedPolicy (URL 署名検証) で OME 単独で完結。Misskey backend との連携は REST
API (8081, 統計ポーリング・強制切断) のみ (AdmissionWebhooks は将来拡張のため
オプション)。

---

## 2. PVE2 上の LXC 作成手順

対象ホスト: **PVE2** (`pve2.msjp-local.org`, 192.168.1.3)。以降のコマンドは
`ssh root@pve2.msjp-local.org -- <command>` の形で実行するか、PVE2 に直接
SSH ログインしたシェルで実行する。

### 2.1 VMID の確定

```bash
ssh root@pve2.msjp-local.org -- pvesh get /cluster/nextid
```

出力された ID をこの後のすべてのコマンドで使う。**実行時点の `pvesh get
/cluster/nextid` の出力が唯一の正** — 以降の手順では説明のため ID を `100`
と仮定して記載する (2026-07-14 実行時点での採番)。実行時の出力に置換すること。

### 2.2 Debian 12 テンプレートの確認・取得

```bash
ssh root@pve2.msjp-local.org -- pveam update
ssh root@pve2.msjp-local.org -- pveam available --section system | grep debian-12
# 例: debian-12-standard_12.12-1_amd64.tar.zst が出力される (2026-07-14 時点)
ssh root@pve2.msjp-local.org -- pveam download local debian-12-standard_12.12-1_amd64.tar.zst
```

`pveam available` の出力バージョン番号 (`12.x-x`) は取得時点で変わりうる。
出力された正確なファイル名をそのまま `pct create` に使うこと (バージョンを
決め打ちで書かない)。

### 2.3 IP 割当方式 — DHCP + Kea reservation + 自動 DDNS (homelab 標準)

本 LXC は **DHCP で IP を取得し、Kea reservation で固定化、Unbound が自動で
`ome.msjp-local.org` を登録する** homelab 標準方式 (2026-04-19 再設計後) を
採用する。手動の静的 IP 指定・手動 Unbound host override は行わない。

根拠: homelab の全 LXC は DHCP + Kea reservation で MAC 固定 IP を取得し、
bridge script が cron 1 分毎に `<hostname>.msjp-local.org` を Unbound に自動
登録する (basic-memory 「Homelab DNS/DHCP/HAProxy システム」ノート参照)。
本 LXC もこの方式に従うことで OPNsense 側の手動 DNS 登録が不要になる。

実際の IP は DHCP で割り当てられた後に確定する。以降 `192.168.1.<DHCP_IP>`
として記載する箇所は、§2.4 のあとに `pct exec <VMID> -- ip addr show eth0`
で確認した実際の IP に置換すること。Kea reservation で IP を固定化したい
場合は OPNsense Web UI (`Services > DHCPv4 > Leases`) から該当 lease に
reservation を追加する (任意、DHCP pool に空きが十分あれば必須ではない)。

### 2.4 LXC 作成

VMID は `pvesh get /cluster/nextid` の出力を採用する (§2.1)。以下の例では
VMID `100` と仮定するが、実行時点の `nextid` 出力に置換すること。

テンプレートファイル名は §2.2 で `pveam available` を実行した時点の実際の
ファイル名を使う。以下の例では `debian-12-standard_12.12-1_amd64.tar.zst`
(2026-07-14 時点) と仮定する。

```bash
ssh root@pve2.msjp-local.org -- pct create 100 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
  --hostname ome \
  --cores 4 \
  --memory 4096 \
  --swap 512 \
  --rootfs m2:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --nameserver 192.168.1.1 \
  --features nesting=1,keyctl=1 \
  --unprivileged 1 \
  --onboot 1
```

パラメータの根拠:
- `--rootfs m2:16` — research-infra.md §4 の推奨どおり m2 プール (NVMe) に
  16GB。I/O 負荷の高い用途向けプールを使う。
- `--memory 4096 --swap 512` — PVE2 は既にスワップ 7.5GB 使用中でメモリ
  余裕が薄いため (research-infra.md §1)、控えめな RAM 割当てから開始し、
  §8.3 の監視で実測後に調整する。
- `--features nesting=1,keyctl=1` — LXC 内で Docker を動かすために必須
  (これがないと `dockerd` が起動しない)。
- `--unprivileged 1` — 既存クラスタの LXC 命名慣習 (`docker-coder` 等) に
  合わせ非特権コンテナとする。
- `--net0 ... ip=dhcp` — DHCP で IP を取得し、Kea + 自動 DDNS で
  `ome.msjp-local.org` が自動登録される (手動 Unbound 追加不要)。

起動と IP 確認:

```bash
ssh root@pve2.msjp-local.org -- pct start 100
# 5-10 秒待ってから
ssh root@pve2.msjp-local.org -- pct exec 100 -- ip addr show eth0 | grep "inet "
# 出力例: inet 192.168.1.111/24 brd 192.168.1.255 scope global dynamic eth0
```

Unbound 自動登録の確認 (DHCP lease 取得後 1 分以内に cron で反映される):

```bash
getent hosts ome.msjp-local.org
# 期待値: 192.168.1.<DHCP_IP>   ome.msjp-local.org
```

解決しない場合は `ssh opnsense 'sudo configctl unbound_dhcpsync run'`
で DDNS 同期を強制実行する。

### 2.5 Docker のインストール (LXC 内)

以降は LXC 内での作業。`pct exec 100 -- <command>` または `pct enter 100`
で入って実行する (VMID 100 は §2.1 の実際の出力に置換)。

LXC 内で直接実行する場合と、PVE ホストから `pct exec` 経由で実行する場合の
両方を記載する。PVE ホストから実行する場合は外側の SSH・`pct exec` のクオート
に注意すること。

```bash
# PVE ホストから一括実行 (推奨、クオートに注意)
ssh root@pve2.msjp-local.org -- pct exec 100 -- bash -c '
set -e
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
'
```

確認:

```bash
ssh root@pve2.msjp-local.org -- pct exec 100 -- docker version
ssh root@pve2.msjp-local.org -- pct exec 100 -- docker compose version
```

両方がエラーなくバージョン文字列を返せば完了。

---

## 3. OME コンテナ起動

LXC 内 (`pct exec 100 -- bash` 等でログイン) に作業ディレクトリを作る。

```bash
ssh root@pve2.msjp-local.org -- pct exec 100 -- mkdir -p /opt/ome
```

`/opt/ome/compose.yml` を以下の内容で作成する (ホスト側からは
`pct push` または LXC 内で直接エディタ編集)。

```yaml
services:
  ome:
    image: ovenmedialabs/ovenmediaengine:latest  # フォールバック: airensoft/ovenmediaengine:v0.20.5
    container_name: ome
    restart: unless-stopped
    ports:
      - "3333:3333/tcp"        # WebRTC signalling (ws)
      - "3334:3334/tcp"        # WebRTC signalling (wss, TLSはHAProxy終端のためLAN内は未使用でも開けておく)
      - "3478:3478/tcp"        # WebRTC TURN relay
      - "8081:8081/tcp"        # REST API
      - "10000-10009:10000-10009/udp"  # WebRTC ICE candidate (最小レンジ)
    volumes:
      - ome-origin-conf:/opt/ovenmediaengine/bin/origin_conf

volumes:
  ome-origin-conf:
```

`ovenmedialabs/ovenmediaengine:latest` を優先し (research-ome.md §0 の結論)、
pull に失敗する場合のみ `airensoft/ovenmediaengine:v0.20.5` に切り替える。
運用時のタグ固定方針は §8.2 参照 (`latest` は初回構築時のみ許容、動作確認後
に固定タグへ切り替える)。

9000/tcp (OVT) と 4000/udp (MPEG-2 TS) は本設計で不使用のため公開しない。

起動:

```bash
pct exec 100 -- bash -c 'cd /opt/ome && docker compose up -d'
```

初回起動でデフォルトの `Server.xml` が名前付きボリュームに生成される。次章
の内容で上書きする。

---

## 4. Server.xml 完全版

初回起動後、いったんコンテナを止めてから編集する。

```bash
pct exec 100 -- bash -c 'cd /opt/ome && docker compose stop ome'
pct exec 100 -- docker volume inspect ome_ome-origin-conf --format '{{ .Mountpoint }}'
# 出力例: /var/lib/docker/volumes/ome_ome-origin-conf/_data
```

出力されたパス配下の `Server.xml` を以下の内容で **完全に置き換える**。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Server version="8">
  <Name>OvenMediaEngine</Name>
  <Type>origin</Type>
  <IP>*</IP>
  <PrivacyProtection>false</PrivacyProtection>
  <StunServer>stun.l.google.com:19302</StunServer>

  <Bind>
    <Managers>
      <API>
        <Port>8081</Port>
        <WorkerCount>1</WorkerCount>
      </API>
    </Managers>

    <Providers>
      <WebRTC>
        <Signalling>
          <Port>3333</Port>
          <TLSPort>3334</TLSPort>
          <WorkerCount>1</WorkerCount>
        </Signalling>
        <IceCandidates>
          <!-- CHANGEME: LAN検証時は LXC のDHCP取得IP (192.168.1.<DHCP_IP>)、WAN公開後(§7)は真のグローバルIPに変更 -->
          <IceCandidate>192.168.1.&lt;DHCP_IP&gt;:10000-10009/udp</IceCandidate>
          <TcpRelay>192.168.1.&lt;DHCP_IP&gt;:3478</TcpRelay>
        </IceCandidates>
      </WebRTC>
    </Providers>

    <Publishers>
      <WebRTC>
        <Signalling>
          <Port>3333</Port>
          <TLSPort>3334</TLSPort>
          <WorkerCount>1</WorkerCount>
        </Signalling>
        <IceCandidates>
          <IceCandidate>192.168.1.&lt;DHCP_IP&gt;:10000-10009/udp</IceCandidate>
          <TcpRelay>192.168.1.&lt;DHCP_IP&gt;:3478</TcpRelay>
        </IceCandidates>
      </WebRTC>
    </Publishers>
  </Bind>

  <Managers>
    <Host>
      <Names>
        <Name>*</Name>
      </Names>
    </Host>
    <API>
      <!-- CHANGEME: §5.1 で生成する API AccessToken -->
      <AccessToken>CHANGEME_API_ACCESS_TOKEN</AccessToken>
      <CrossDomains>
        <Url>*</Url>
      </CrossDomains>
    </API>
  </Managers>

  <VirtualHosts>
    <VirtualHost>
      <Name>default</Name>
      <Host>
        <Names>
          <Name>*</Name>
        </Names>
      </Host>

      <!-- SignedPolicy: ingest (WHIP Provider) only. Publishers (playback) is NOT enforced — anonymous viewing by design. -->
      <SignedPolicy>
        <PolicyQueryKeyName>policy</PolicyQueryKeyName>
        <SignatureQueryKeyName>signature</SignatureQueryKeyName>
        <!-- CHANGEME: §5.1 で生成する SignedPolicy SecretKey -->
        <SecretKey>CHANGEME_SIGNED_POLICY_SECRET</SecretKey>
        <Enables>
          <!-- WHIP-only 構成: SignedPolicy は WHIP Provider (ingest) のみ有効。
               Phase 0 実機検証済: 無署名 WHIP 接続は 401 拒否、署名ありは通過。
               視聴 (Publisher) は匿名アクセスを許可するため SignedPolicy を適用しない。 -->
          <Providers>webrtc</Providers>
        </Enables>
      </SignedPolicy>

      <!-- AdmissionWebhooks: 本設計ではオプション。将来的なライフサイクル通知・
           bit rate 超過時の即時遮断・ブラックリスト連携等で必要になったら
           有効化する。詳細は 00-overview.md D3、本文書 §6(e) 参照。
           Phase 2 では SignedPolicy のみで認可完結するため、コメントアウトのまま運用可能。 -->
      <!--
      <AdmissionWebhooks>
        <ControlServerUrl>http://mi-host.msjp-local.org:3000/ome/admission</ControlServerUrl>
        <SecretKey>CHANGEME_ADMISSION_WEBHOOKS_SECRET</SecretKey>
        <Timeout>3000</Timeout>
        <Enables>
          <Providers>webrtc</Providers>
          <Publishers>webrtc</Publishers>
        </Enables>
      </AdmissionWebhooks>
      -->

      <Applications>
        <Application>
          <Name>live</Name>
          <Type>live</Type>

          <OutputProfiles>
            <HardwareAcceleration>false</HardwareAcceleration>
            <OutputProfile>
              <Name>bypass_stream</Name>
              <OutputStreamName>${OriginStreamName}</OutputStreamName>
              <Encodes>
                <Video>
                  <Bypass>true</Bypass>
                </Video>
                <Audio>
                  <Bypass>true</Bypass>
                </Audio>
              </Encodes>
            </OutputProfile>
          </OutputProfiles>

          <Providers>
            <WebRTC>
              <Timeout>30000</Timeout>
            </WebRTC>
          </Providers>

          <!-- WebRTC-only publisher. LLHLS/OVT/File/Push removed for resource saving. -->
          <Publishers>
            <AppWorkerCount>1</AppWorkerCount>
            <StreamWorkerCount>1</StreamWorkerCount>
            <WebRTC>
              <Timeout>30000</Timeout>
              <Rtx>false</Rtx>
              <Ulpfec>false</Ulpfec>
              <JitterBuffer>false</JitterBuffer>
              <PlayoutDelay>
                <Min>0</Min>
                <Max>0</Max>
              </PlayoutDelay>
            </WebRTC>
          </Publishers>
        </Application>
      </Applications>
    </VirtualHost>
  </VirtualHosts>
</Server>
```

反映と再起動:

```bash
pct exec 100 -- bash -c 'cd /opt/ome && docker compose up -d ome'
pct exec 100 -- docker compose -f /opt/ome/compose.yml logs -f ome
```

ログにエラー (XML パースエラー、ポートバインド失敗等) が出ないことを確認し
てから `Ctrl-C` でログ追跡を終了する。

---

## 5. シークレット生成と Misskey 側 config 対応表

### 5.1 生成コマンド

2 種類 `openssl rand` で生成する (base64、記号除去、32byte)。AdmissionWebhooks
はオプションのため、その SecretKey は将来有効化する際に生成してよい。

```bash
# API AccessToken (REST API 認証)
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo

# SignedPolicy SecretKey (WHIP ingest の認可に必須)
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo

# AdmissionWebhooks SecretKey (オプション、将来有効化時に生成)
# openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo
```

**同じ値を使い回さない** (用途が異なるため漏洩時の影響範囲を分離する)。

### 5.2 Server.xml ↔ Misskey config.ts 対応表

| # | シークレット | Server.xml の反映先 | Misskey `default.yml` キー (architecture-decisions.md §2) |
|---|---|---|---|
| 1 | API AccessToken | `<Managers><API><AccessToken>` | `ome.apiToken` |
| 2 | SignedPolicy SecretKey | `<VirtualHost><SignedPolicy><SecretKey>` (WHIP Provider 認可に必須) | `ome.signedPolicySecret` |
| 3 | AdmissionWebhooks SecretKey (オプション) | `<VirtualHost><AdmissionWebhooks><SecretKey>` (§4 ではコメントアウト、将来有効化時に設定) | `ome.admissionSecret` (将来利用時) |

Misskey 側 `.config/default.yml` (architecture-decisions.md §2 のブロックを
そのまま使用、値のみ本手順で生成したものに置換):

```yaml
ome:
  apiUrl: 'http://ome.msjp-local.org:8081'
  apiToken: '<5.1で生成したAPI AccessToken>'
  signedPolicySecret: '<5.1で生成したSignedPolicy SecretKey>'
  publicWhipUrl: 'http://stream.msjp.pro:3333'   # ⚠ 未確定事項 #6 (FQDN確定後に反映)
  vhost: 'default'
  app: 'live'
  maxVideoBitrate: 3000
  maxAudioBitrate: 128
```

`admissionSecret` は AdmissionWebhooks を有効化する際に追加する。

`default.yml` へのこの反映は Phase 1/2 の backend 実装作業に属するため、
本文書の完了条件には含めない (§0 のチェックリスト参照)。ここでは値の対応
関係のみ確定させる。

---

## 6. LAN 内疎通検証手順

以下 (a)〜(e) の順に実施する。すべて LAN 内で完結し、破壊的操作は含まない。

### (a) REST API 応答確認

```bash
TOKEN=$(echo -n '<5.1で生成したAPI AccessToken>' | base64)
curl -sS -H "Authorization: Basic ${TOKEN}" \
  http://192.168.1.<DHCP_IP>:8081/v1/vhosts/default/apps/live/streams
```

期待値: `{"statusCode":200,"message":"OK","response":[]}` (配信前は空配列)。
`statusCode` が 200 以外、または接続不可の場合は §3/§4 の手順を見直す。

### (b) OBS → WHIP ingest 確認

OBS の設定:
- サービス: カスタム
- サーバー: `http://ome.msjp-local.org:3333/live/test001?direction=whip`
- Bearer Token: 空 (SignedPolicy の `policy`/`signature` クエリで認可)

Phase 0 では SignedPolicy を有効にする前、または一時的に `Enables` の
`Providers` を空にして無効化した状態で初回疎通確認を行う。SignedPolicy
を有効化する場合は、Misskey backend 側で署名付き WHIP URL を発行するか、
03-backend-ome-integration.md §9-2 の手順で curl から一時的な署名 URL を
生成して使用する。

配信開始後:

```bash
curl -sS -H "Authorization: Basic ${TOKEN}" \
  http://192.168.1.<DHCP_IP>:8081/v1/vhosts/default/apps/live/streams
```

期待値: `"response":["test001"]` のように配信中のストリーム名が返る。返ら
ない場合は OBS 側の接続ログと OME コンテナログ (`docker compose logs ome`)
を突き合わせる。

**注意**: WHIP-only 構成では、映像は H264・音声は Opus が必要。AAC の
音声トラックは OME の WebRTC 出力で無視される (Phase 0 で確認済み)。

### (c) WebRTC 再生確認

OME 公式デモページ、または OvenPlayer の [デモページ](https://demo.ovenplayer.com/)
の「Stream URL」欄に以下を入力して再生確認する:

```
ws://ome.msjp-local.org:3333/live/test001
```

(LAN 内 FQDN 経由。IP 直指定の場合は `ws://192.168.1.<DHCP_IP>:3333/live/test001`)

映像・音声が遅延数百ms程度で再生されれば成功。再生できない場合は Publishers
の WebRTC 設定 (§4) と、ブラウザの開発者ツールで WebSocket 接続エラー/ICE
接続エラーの有無を確認する。

SignedPolicy を Publishers (`webrtc`) にも適用している場合、視聴 URL にも
有効な `policy`/`signature` クエリが必要になる。Phase 0 初回検証では
Publishers のみ一時的に無効化するか、署名付き視聴 URL を Misskey backend
から取得して使う。

### (d) bitrateLatest/bitrateAvg の実測記録 (⚠ 未確定事項 #4)

配信中に以下を複数回 (例: 開始直後・1分後・5分後) 実行し、値の変化を記録する。

```bash
curl -sS -H "Authorization: Basic ${TOKEN}" \
  http://192.168.1.<DHCP_IP>:8081/v1/vhosts/default/apps/live/streams/test001 \
  | python3 -m json.tool
```

記録項目: `input.tracks[].video.bitrate` / `bitrateAvg` / `bitrateConf` /
`bitrateLatest` の 4 フィールドそれぞれの値と、OBS 側エンコーダ設定の実際の
ビットレート (CBR指定値) との対応関係。目的は「どのフィールドが直近の瞬間
実測値か」を確定させること (research-ome.md §6 で未確認と明記されている点)。
記録結果は 00-overview.md の未確定事項 #4 にフィードバックし、
`OmeStreamMonitorService` (Phase 2) の閾値判定にどのフィールドを使うか確定
させる。

**実測結果 (2026-07-14, OBS WHIP / CBR 2800kbps / 1280x720 / 48fps / H264 / Opus 128kbps)**:

| フィールド | 値 (1回目) | 値 (2回目, 30秒後) | 意味 |
|---|---|---|---|
| `bitrateConf` | 2800000 | 2800000 | OBS 設定値の反映 (不変) |
| `bitrate` | 2800000 | 2800000 | `bitrateConf` と同一 (設定値) |
| `bitrateAvg` | 546576 | 551616 | 配信開始からの移動平均 |
| `bitrateLatest` | 545485 | 550514 | **直近の瞬間実測値** |

Audio (Opus 128kbps CBR): `bitrateConf=128000` / `bitrateAvg≈130600` /
`bitrateLatest≈130700` — CBR のため値が安定。

**Phase 0 での重要な発見**: RTMP ingest では AAC 音声が OME の WebRTC
Publisher に無視されて音声が出なかった。WHIP ingest では Opus がネイティブで
送られるため、映像・音声ともに Bypass かつ正常に視聴できた。これを受けて
本設計は WHIP-only とし、RTMP/SRT ingest を廃止する (00-overview.md
D3・未確定事項 #5 参照)。

**結論**: `OmeStreamMonitorService` の閾値判定には **`bitrateLatest`** を
使用する。`bitrateConf`/`bitrate` は OBS 設定値の反映であり実測値ではない
ため閾値判定に使えない。実測値は OBS 設定値を大幅に下回る場合がある
(画面内容が静止画に近い場合等) — これは CB R 設定でも発生する正常挙動。

**リソースベースライン (docker stats)**:
- 最適化前 (1配信1視聴者、LLHLS/OVT コンポーネント初期化済み):
  CPU 3.68% / MEM 16.11MiB (4GB割当中) / NET 48.3MB(in) 10.3MB(out)。
- 最適化後 (idle, LLHLS/OVT コンポーネント除去):
  CPU 0.24% / MEM 9.79MiB (4GB割当中)。

Bypass モードのためトランスコード負荷は無く、CPU 負荷は低い。PVE2 にメモリ
圧迫があるため、本番までに不要な Publisher (LLHLS/OVT/File/Push) は
Server.xml から除去済み。本格負荷試験は WI-5.1 で実施。

### (e) AdmissionWebhooks の無効化/有効化タイミング

**無効化 (Phase 0 の間、デフォルト)**: §4 の Server.xml のとおり
`<AdmissionWebhooks>` ブロックはコメントアウトしたままにする。理由:
Misskey 側の `/ome/admission` エンドポイントが実装されるのは Phase 2 であり、
それ以前に有効化すると OME が存在しない URL への HTTP POST を試みてタイム
アウトし (Server.xml の `Timeout` 経過後)、全 ingest/視聴が `allowed:false`
相当で拒否される。

**有効化の判断基準**: 以下 3 条件がすべて満たされた時点で有効化してよい。
1. Phase 2 の `/ome/admission` route (`OmeServerService.ts`) が mi-host
   にデプロイ済みで、`curl http://mi-host.msjp-local.org:3000/ome/admission`
   に到達可能 (403 でも良い、接続不能でないことの確認)
2. `X-OME-Signature` 検証ロジックが AdmissionWebhooks SecretKey (§5.1 の #2)
   と一致する値で設定済み
3. `opening`/`closing` それぞれのレスポンス形式がresearch-ome.md §4 の仕様
   どおり実装されている (`allowed` boolean 必須、`closing` は空 JSON 可)

有効化手順: Server.xml の `<!-- ... -->` コメントを外し、`SecretKey` を
§5.1 の #2 に置換した上で `docker compose up -d ome` で再読込 (再起動が
必要、ホットリロードなし)。有効化直後は (a)〜(c) を再実施し、認可が正しく
機能することを確認する。

---

## 7. WAN 公開 — すべて人間の承認後に実施すること

**本セクションの内容は Phase 0 の完了条件に含まれない。実施は 00-overview.md
の未確定事項 #6 (FQDN・WAN公開ポリシー例外) についてユーザーの明示的な承認
を得てから、独立した作業として行う。** 現行の WAN 公開ポリシーは「意図的
公開は Matrix federation / Minecraft / WireGuard のみ、その他は LAN-only」
であり (research-infra.md §6)、OME の WAN 公開はこのポリシーへの新規例外
追加にあたる。

### 7.1 事前作業: OPNsense config backup

破壊的変更ではないが、NAT/HAProxy/DNS の変更を伴うため CLAUDE.md §10 の
方針に従い、変更前に config export を取得する。

```
OPNsense Web UI > System > Configuration > Backups > Download configuration
```

取得日時とファイル名を作業記録に残すこと。

### 7.1.5 上位ルーターのポート開放 (二重ルーター構成、人間が手動実施)

ホームラボは二重ルーター構成 (ISP 上位ルーター → OPNsense → LAN) のため、
OPNsense の NAT (§7.2) に加えて **上位ルーターで以下のポートを OPNsense の
WAN 側 IP へ転送する設定を人間が手動で追加する** 必要がある (2026-07-14
ユーザー承認済み)。

| プロトコル | ポート | 転送先 | 用途 |
|---|---|---|---|
| UDP | 10000-10009 | OPNsense WAN側IP | WebRTC ICE (配信 WHIP + 視聴メディア) |
| TCP | 3478 | OPNsense WAN側IP | WebRTC TURN relay (UDP 不可環境の視聴フォールバック) |

TCP 443 (wss signalling / WHIP、HAProxy 経由) は既存の公開設定 (80/443) で
開放済みのため追加不要。REST API 8081 と signalling 素通し 3333/3334 は
**上位ルーターでも開放しない** (LAN 内 + HAProxy 経由限定)。

### 7.2 OPNsense NAT ルール (すべて新規追加)

| プロトコル | WANポート | 宛先 | 宛先ポート | 用途 | 既存ルールとの関係 |
|---|---|---|---|---|---|
| UDP | 10000-10009 | 192.168.1.\<DHCP_IP\> | 10000-10009 | WebRTC ICE candidate (最小レンジ、Server.xml の設定と一致させる) | 新規 |
| TCP | 3478 | 192.168.1.\<DHCP_IP\> | 3478 | WebRTC TURN relay (フォールバック) | 新規 |

signalling (3333/3334) と REST API (8081) は NAT せず、HAProxy 経由に限定
する (§7.3)。ICE UDP レンジは Server.xml の `IceCandidates` に設定した
レンジと厳密に一致させること (レンジを広げるほど攻撃面が増えるため、実際に
使う最小レンジのみ開放する — research-infra.md §6.2 の指摘どおり)。

### 7.3 HAProxy 設定方針

- 対象: WebRTC signalling (wss, 3333/3334) のみ。ICE/TURN のメディアパケット
  は L4/L7 プロキシを経由できないため §7.2 の直接 NAT のみで扱う
  (research-ome.md §10)。
- ACL: 既存の Matrix federation パターン (`is_matrix_host`) に倣い
  `is_ome_host` ACL を新設し、`stream.msjp.pro` 宛のリクエストのみ backend
  へ転送する。他の FQDN と同じ `https_frontend` 上で `is_lan` ACL による
  403 deny の例外として追加する。
- TLS 終端は HAProxy 側、既存 `*.msjp.pro` wildcard 証明書を流用する
  (OME 側は TLS なしの平文 signalling で待ち受け、HAProxy → OME 間は LAN
  内 plain HTTP/WS で良い)。
- backend ヘルスチェック: `GET /v1/vhosts/default/apps/live/streams`
  相当の到達性チェック、または TCP connect チェック (3333番ポート)。

### 7.4 DNS

- Cloudflare (外部公開 DNS): `stream.msjp.pro` → **真のグローバル IP
  (上位ルーターの WAN IP)** の A レコードを追加。二重ルーター構成のため
  OPNsense の WAN 側 IP はプライベートアドレスであり、DNS に載せるのは
  上位ルーター側のグローバル IP である点に注意 (既存の `mi.msjp.pro` と
  同じ値になるはず — 既存レコードで確認)。
- Unbound (LAN 内 split-DNS): `stream.msjp.pro` → `192.168.1.<DHCP_IP>`
  (ome LXC の LAN IP) への host override を追加。LAN 内クライアントが
  同じ FQDN でアクセスした際に WAN 経由の NAT loopback を経由せず直接到達
  できるようにするため (research-infra.md §6.3 の NAT reflection/split-DNS
  の指摘に対応)。

### 7.5 IceCandidates の切り替え

WAN 公開後は Server.xml の `<IceCandidate>` / `<TcpRelay>` を LAN 内 IP
から **真のグローバル IP (上位ルーターの WAN IP)** に書き換える。二重
ルーター構成のため OPNsense の WAN 側 IP (プライベート) を書いても外部
から到達できない。LAN 内視聴者は §7.4 の split-DNS により同じ FQDN で
引き続き到達できるため、Server.xml 上の値を LAN/WAN で出し分ける必要はない。

```xml
<IceCandidate><真のグローバルIP(上位ルーターWAN)>:10000-10009/udp</IceCandidate>
<TcpRelay><真のグローバルIP(上位ルーターWAN)>:3478</TcpRelay>
```

注: ISP のグローバル IP が動的な場合、IP 変動のたびに Server.xml の書き換えと
OME 再起動が必要になる。`${PublicIP}` (STUN 自動解決) が二重 NAT 環境で正しく
外側 IP を返すかは Phase 0 実機検証項目に含める — 正しく返るなら固定書きせず
`${PublicIP}` 運用が望ましい。

### 7.6 事後検証コマンド

WAN 側 (外部ネットワークからの実行、例: モバイル回線でテザリングした端末等
LAN外の環境):

```bash
# signalling が HAProxy 経由で到達するか (LANからの直接到達ではないことも含めて確認)
curl -sSI https://stream.msjp.pro:3334/live/test001

# ICE UDPレンジ (代表ポートのみ)
nc -zvu stream.msjp.pro 10000

# TURN relay TCP
nc -zv stream.msjp.pro 3478
```

`homelab-ops` の監査コマンド (basic-memory 「Homelab public (WAN) surface」
ノート記載) で新規開放ポートを事後棚卸しすること (research-infra.md §6.6)。

---

## 8. 運用

### 8.1 ログの見方

コンテナログは Docker 経由で確認する (LXC 内):

```bash
docker compose -f /opt/ome/compose.yml logs -f ome
```

イメージ内のログファイルは `/var/log/ovenmediaengine/` 配下 (コンテナ内
パス)。永続化してホストから直接参照したい場合は compose.yml の
`volumes` に以下を追加する (Phase 0 完了後、必要になった時点で追加する
任意作業。デフォルト構成では未設定):

```yaml
    volumes:
      - ome-origin-conf:/opt/ovenmediaengine/bin/origin_conf
      - ./logs:/var/log/ovenmediaengine
```

確認頻度の目安: 配信トラブル報告時、または §8.3 のリソース監視で異常値
を検知した時にログを遡る。定常監視でのログ tail 常時実行は不要。

### 8.2 アップグレード方針

- 本番運用移行後 (Phase 5 完了後) は `docker-compose.yml` の `image` タグを
  `latest` から **固定バージョンタグ** (例 `ovenmedialabs/ovenmediaengine:v0.20.5`
  相当、公式リリースの実際のタグ名に置換) に切り替える。理由: `latest` の
  自動追従は無停止アップグレードのタイミングを運用側が制御できず、配信中の
  切断リスクがある。
- アップグレード手順: (1) タグ変更 → (2) 検証環境 (未使用時間帯の LAN 内
  再検証、§6 (a)〜(c) を再実行。特に WHIP ingest + SignedPolicy の組み合わせ)
  → (3) 本番タグ切り替え + `docker compose pull && docker compose up -d`。
  配信が行われていない時間帯に実施する。
- Server.xml のフォーマット互換性: research-ome.md §1 のとおり v0.12.6
  以降で互換のため、マイナーバージョン間のアップグレードで Server.xml の
  書き換えは基本的に不要。メジャーバージョン更新時のみ公式 Changelog を
  確認する。

### 8.3 リソース監視の目安

- CPU: Bypass のみの運用では総データ量 (ビットレート合計) に比例する
  (research-ome.md §11 の GitHub Discussions 実運用報告)。目安として
  配信本数ではなく `該当時刻の全配信ビットレート合計` を監視指標とする。
- メモリ: pve2 自体がスワップ常用状態 (research-infra.md §1) のため、
  `pct exec 100 -- free -h` を定期確認し、LXC 側の使用量が §2.4 で割り当
  てた 4096MB に対して逼迫していないか確認する。逼迫時は `pct set 100
  --memory <増量値>` で調整する (LXC の動的メモリ調整、無停止で反映可能)。
- ディスク: Bypass のため録画/セグメントを持続的に書き出す設定ではない
  想定 (本設計に DVR/LLHLS は含まない)。`pct exec 100 -- df -h /` で
  rootfs (m2 プール 16GB) の空き容量を定期確認する。
- 具体的な「同時視聴者N人・配信M本ならvCPU X, RAM Y GB」という定量目安は
  公式資料に確証がなく (research-ome.md §11)、Phase 0 の実測 (§6(d) と
  合わせて配信中の `docker stats ome` 実行) をベースラインとして記録し、
  本番規模の見積りに使う。
