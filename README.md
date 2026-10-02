# Control Center

Discord botu ve Discord OAuth2 web kontrol paneli. Kanal oluşturma, 24 saatlik davet üretip panel kullanıcısına DM gönderme, sunucu içi özel ticket açma ve ticket kapatma özelliklerini içerir.

## Kurulum

1. Node.js 18.17 veya daha yenisini kur.
2. Discord Developer Portal'da bir uygulama oluştur. Bot tokenini al, **Message Content Intent** ve **Server Members Intent** seçeneklerini aç.
3. OAuth2 Redirects bölümüne `http://localhost:3000/auth/callback` ekle.
4. Botu `Manage Channels`, `Create Instant Invite`, `Send Messages`, `View Channels`, `Read Message History`, `View Audit Log` ve `Ban Members` izinleriyle sunucuna ekle. Vanity URL denetimi için bot rolünü, banlayacağı üyelerin rollerinin üstüne taşı.
5. `.env.example` dosyasını `.env` olarak kopyala ve değerleri doldur.
6. `npm install` ve `npm start` çalıştır. Panel: `http://localhost:3000`.

Windows'ta daha kolay kullanım için `start.bat` dosyasına çift tıklayabilirsin. İlk çalıştırmada `.env` dosyasını oluşturur; Discord bilgilerini girdikten sonra tekrar çalıştırman yeterlidir.

## Ayarlar

`TICKET_SUPPORT_ROLE_ID` başlangıç destek rolüdür; sunucu sahibi bunu `/ayar destek-rolu` ile değiştirebilir. Ticket kayıtları `data/store.json` içinde tutulur; üretimde bu klasörü kalıcı disk/volume ile sakla.

## Discord komutları

`/panel` sunucu kontrol panelini açar. `/yardim` veya `help` komutu tüm komutları menü halinde gösterir.

- Ticket: `/ticket`, `/ticket-panel`, `/ticket-kapat`, `/ticket-ekle`, `/ticket-cikar`
- Moderasyon: `/sil`, `/kanal-sil`, `/rol-ekle`, `/rol-ver`
- Ayarlar: `/ayar kategori`, `/ayar destek-rolu`, `/ayar hosgeldin`, `/ayar ayrilma`, `/ayar otomatik-rol`, `/ayar vanity-rol-ekle`, `/ayar vanity-rol-cikar`
- Bilgi: `/sunucu-bilgi`

Sunucu ayarlarını yalnızca sunucu sahibi değiştirebilir. `/ayar destek-rolu` ile seçilen rol; mesaj silme, kanal silme, rol ekleme ve ticket yönetimi komutlarında kullanılabilir. Botun rolü, işlem yapacağı rollerin üstünde olmalı ve botta **Kanalları Yönet**, **Mesajları Yönet**, **Rolleri Yönet**, **Üyeleri Yönet** izinleri bulunmalıdır.

Vanity URL denetiminde sunucu sahibi `/ayar vanity-rol-ekle` ile URL değiştirmesine izin verilen rolleri tanımlar; `/ayar vanity-rol-cikar` rolün iznini kaldırır. İzinli rollerden hiçbiri olmayan biri vanity URL'yi değiştirirse bot audit log üzerinden yapanı bulup banlamaya çalışır. Bunun için **Denetim Kaydını Görüntüle** ve **Üyeleri Yasakla** izinleri gerekir.

Discord bot API'si vanity URL'yi değiştirmeye veya geri almaya izin vermiyor ve değişikliği ancak gerçekleştikten sonra bildiriyor. Bu nedenle bot URL işlemini engelleyemez ya da otomatik geri alamaz; URL değişebilir ve sahibinin Discord sunucu ayarlarından düzeltmesi gerekebilir. Audit log'da yapan kişi bulunamazsa ban da uygulanamaz.

`/ticket-panel` komutu bir kanala ticket düğmesi gönderir. Kullanıcı düğmeye bastığında `ticket-0001` gibi, sadece kullanıcı, bot ve destek rolünün görebildiği özel kanal açılır. Ticket DM üzerinden açılmaz.

## 7/24 çalıştırma

Docker ile: `docker build -t discord-control-center .` ardından `.env` dosyanı vererek `docker run -d --restart unless-stopped --env-file .env -p 3000:3000 -v ${PWD}/data:/app/data discord-control-center` çalıştır. Render, Railway, Fly.io veya VPS üzerinde de aynı `npm start` komutu kullanılabilir. Hosting tarafında `DISCORD_REDIRECT_URI` değerini gerçek HTTPS callback adresi yap.

## Güvenlik

`.env` dosyanı, bot tokenini ve OAuth secret değerini Git'e gönderme. Token sızarsa Discord Developer Portal'dan yenile. Bu proje temel paneldir; çok kullanıcılı üretim ortamında rol tabanlı erişim, CSRF koruması ve Redis tabanlı session store eklenmelidir.