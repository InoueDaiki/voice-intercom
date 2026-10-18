// 言語ごとの例文。インカムで話しそうな文で、数字と固有名詞(佐藤、鈴木、田中、成田空港、ACME 物流、B ホール)を含む。
// 訳文はこの PoC のために用意したもので、gpt-6-luna の訳ではない。
// `speech` は長い発話を字幕の区切りに分けたもの(待ち行列の模擬で、数秒ごとに1つずつ届かせる)。

import type { LangCode } from "./core/languages.ts";

export interface Samples {
  /** 短い文 */
  short: string;
  /** 長めの文 */
  long: string;
  /** 長い発話の区切り */
  speech: readonly string[];
}

export const SAMPLES: Record<LangCode, Samples> = {
  ja: {
    short: "田中さん、14番ゲートに無線機を2台持ってきてください。",
    long: "ACME 物流から椅子250脚が午後3時45分にBホール裏の搬入口に届くので、3人で荷下ろしをして、注文番号7082と数が合っているか確認してください。",
    speech: [
      "スタッフの皆さん、本部の佐藤です。",
      "午後2時の公演は開場が15分遅れて、2時15分になります。",
      "3番ゲートに約300人のお客様が並んでいるので、5番ゲートから2人応援をお願いします。",
      "鈴木さん、Bホールの12列目の車椅子席を確認して、報告してください。",
      "成田空港からのバスが渋滞に巻き込まれていて、到着は2時40分ごろの見込みです。",
      "そのお客様は、2階の受付に直接ご案内してください。",
      "変更があれば、4チャンネルで連絡します。よろしくお願いします。",
    ],
  },
  en: {
    short: "Tanaka, please bring 2 radios to Gate 14.",
    long: "The delivery of 250 chairs from Acme Logistics will arrive at the loading dock behind Hall B at 3:45 PM, so please have three people ready to unload them and check the count against order number 7082.",
    speech: [
      "All staff, this is Sato from the control room.",
      "The doors for the 2 PM show will open 15 minutes late, at 2:15.",
      "About 300 guests are waiting at Gate 3, so please send two more people from Gate 5.",
      "Suzuki, please check the wheelchair spaces in row 12 of Hall B and report back.",
      "The bus from Narita Airport is stuck in traffic and will arrive around 2:40.",
      "Please guide those guests directly to the reception desk on the 2nd floor.",
      "If anything changes, I will contact you on channel 4. Thank you.",
    ],
  },
  es: {
    short: "Tanaka, por favor trae 2 radios a la puerta 14.",
    long: "La entrega de 250 sillas de Acme Logistics llegará al muelle de carga detrás del Hall B a las 15:45, así que tengan listas a tres personas para descargarlas y comprobar la cantidad con el número de pedido 7082.",
    speech: [
      "A todo el personal, les habla Sato desde la sala de control.",
      "Las puertas para el espectáculo de las 14:00 se abrirán con 15 minutos de retraso, a las 14:15.",
      "Hay unos 300 invitados esperando en la puerta 3, así que envíen a dos personas más desde la puerta 5.",
      "Suzuki, por favor revisa los espacios para sillas de ruedas en la fila 12 del Hall B e informa.",
      "El autobús del aeropuerto de Narita está atascado en el tráfico y llegará hacia las 14:40.",
      "Por favor, lleven a esos invitados directamente a la recepción del 2.º piso.",
      "Si hay algún cambio, los contactaré por el canal 4. Gracias.",
    ],
  },
  pt: {
    short: "Tanaka, por favor traga 2 rádios para o portão 14.",
    long: "A entrega de 250 cadeiras da Acme Logistics vai chegar à doca de carga atrás do Hall B às 15h45, então deixem três pessoas prontas para descarregar e conferir a quantidade com o número do pedido 7082.",
    speech: [
      "Atenção, equipe, aqui é o Sato, da sala de controle.",
      "As portas para o show das 14h vão abrir com 15 minutos de atraso, às 14h15.",
      "Há cerca de 300 convidados esperando no portão 3, então mandem mais duas pessoas do portão 5.",
      "Suzuki, por favor verifique os espaços para cadeirantes na fileira 12 do Hall B e me avise.",
      "O ônibus do aeroporto de Narita está preso no trânsito e deve chegar por volta das 14h40.",
      "Por favor, levem esses convidados direto para a recepção no 2º andar.",
      "Se algo mudar, eu aviso vocês pelo canal 4. Obrigado.",
    ],
  },
  fr: {
    short: "Tanaka, apportez 2 radios à la porte 14, s'il vous plaît.",
    long: "La livraison de 250 chaises de Acme Logistics arrivera au quai de chargement derrière le Hall B à 15 h 45, alors prévoyez trois personnes pour les décharger et vérifier la quantité avec le numéro de commande 7082.",
    speech: [
      "À tout le personnel, ici Sato depuis la salle de contrôle.",
      "Les portes pour le spectacle de 14 h ouvriront avec 15 minutes de retard, à 14 h 15.",
      "Environ 300 invités attendent à la porte 3, alors envoyez deux personnes de plus depuis la porte 5.",
      "Suzuki, vérifiez les places pour fauteuils roulants au rang 12 du Hall B et faites-moi un retour.",
      "Le bus de l'aéroport de Narita est bloqué dans les embouteillages et arrivera vers 14 h 40.",
      "Merci de conduire ces invités directement à l'accueil au 2e étage.",
      "En cas de changement, je vous contacterai sur le canal 4. Merci.",
    ],
  },
  de: {
    short: "Tanaka, bitte bring 2 Funkgeräte zu Tor 14.",
    long: "Die Lieferung von 250 Stühlen von Acme Logistics kommt um 15:45 Uhr an der Laderampe hinter Halle B an, also haltet bitte drei Leute zum Abladen bereit und prüft die Anzahl mit der Bestellnummer 7082.",
    speech: [
      "An alle Mitarbeiter, hier spricht Sato aus der Leitstelle.",
      "Der Einlass für die Vorstellung um 14 Uhr beginnt 15 Minuten später, um 14:15 Uhr.",
      "Am Tor 3 warten etwa 300 Gäste, bitte schickt zwei weitere Leute von Tor 5.",
      "Suzuki, bitte prüf die Rollstuhlplätze in Reihe 12 von Halle B und gib mir Bescheid.",
      "Der Bus vom Flughafen Narita steckt im Stau und kommt gegen 14:40 Uhr an.",
      "Bitte führt diese Gäste direkt zum Empfang im 2. Stock.",
      "Wenn sich etwas ändert, melde ich mich auf Kanal 4. Danke.",
    ],
  },
  it: {
    short: "Tanaka, per favore porta 2 radio al cancello 14.",
    long: "La consegna di 250 sedie da Acme Logistics arriverà alla banchina di carico dietro la Hall B alle 15:45, quindi tenete pronte tre persone per scaricarle e controllare il numero con l'ordine 7082.",
    speech: [
      "A tutto il personale, qui è Sato dalla sala di controllo.",
      "Le porte per lo spettacolo delle 14 apriranno con 15 minuti di ritardo, alle 14:15.",
      "Ci sono circa 300 ospiti in attesa al cancello 3, quindi mandate altre due persone dal cancello 5.",
      "Suzuki, per favore controlla i posti per sedie a rotelle nella fila 12 della Hall B e fammi sapere.",
      "L'autobus dall'aeroporto di Narita è bloccato nel traffico e arriverà verso le 14:40.",
      "Per favore accompagnate quegli ospiti direttamente alla reception al 2° piano.",
      "Se cambia qualcosa, vi contatto sul canale 4. Grazie.",
    ],
  },
  ru: {
    short: "Танака, пожалуйста, принеси 2 рации к воротам 14.",
    long: "Поставка 250 стульев от Acme Logistics прибудет к погрузочной площадке за залом B в 15:45, поэтому подготовьте трёх человек, чтобы разгрузить их и сверить количество с номером заказа 7082.",
    speech: [
      "Всем сотрудникам, говорит Сато из диспетчерской.",
      "Вход на шоу в 14:00 откроется на 15 минут позже, в 14:15.",
      "У ворот 3 ждут около 300 гостей, пришлите, пожалуйста, ещё двух человек от ворот 5.",
      "Судзуки, проверь, пожалуйста, места для инвалидных колясок в 12-м ряду зала B и доложи.",
      "Автобус из аэропорта Нарита застрял в пробке и прибудет примерно в 14:40.",
      "Пожалуйста, проводите этих гостей прямо к стойке регистрации на 2-м этаже.",
      "Если что-то изменится, я свяжусь с вами по 4-му каналу. Спасибо.",
    ],
  },
  zh: {
    short: "田中,请把2台对讲机拿到14号门。",
    long: "ACME 物流的250把椅子将在下午3点45分送到B馆后面的卸货区,请安排三个人卸货,并按照订单号7082核对数量。",
    speech: [
      "各位工作人员,我是控制室的佐藤。",
      "下午2点的演出推迟15分钟开门,改为2点15分。",
      "3号门有大约300位客人在排队,请从5号门再派两个人过去。",
      "铃木,请检查B馆第12排的轮椅位,然后回报。",
      "从成田机场来的大巴遇到堵车,预计2点40分左右到达。",
      "请把这些客人直接带到2楼的接待处。",
      "如果有变化,我会在4频道联系大家。谢谢。",
    ],
  },
  ko: {
    short: "다나카 씨, 14번 게이트로 무전기 2대 가져와 주세요.",
    long: "ACME 물류에서 의자 250개가 오후 3시 45분에 B홀 뒤 하역장에 도착하니, 세 명이 하역을 준비하고 주문 번호 7082와 수량이 맞는지 확인해 주세요.",
    speech: [
      "스태프 여러분, 통제실의 사토입니다.",
      "오후 2시 공연은 입장이 15분 늦어져 2시 15분에 시작합니다.",
      "3번 게이트에 손님 약 300명이 기다리고 있으니, 5번 게이트에서 두 명 더 보내 주세요.",
      "스즈키 씨, B홀 12열의 휠체어석을 확인하고 보고해 주세요.",
      "나리타 공항에서 오는 버스가 차가 막혀서 2시 40분쯤 도착할 예정입니다.",
      "그 손님들은 2층 접수처로 바로 안내해 주세요.",
      "변경 사항이 있으면 4번 채널로 연락하겠습니다. 감사합니다.",
    ],
  },
  hi: {
    short: "तनाका, कृपया गेट 14 पर 2 रेडियो ले आइए।",
    long: "ACME लॉजिस्टिक्स से 250 कुर्सियों की डिलीवरी दोपहर 3:45 बजे हॉल B के पीछे लोडिंग डॉक पर पहुँचेगी, इसलिए तीन लोगों को सामान उतारने और ऑर्डर नंबर 7082 से गिनती मिलाने के लिए तैयार रखिए।",
    speech: [
      "सभी स्टाफ़ ध्यान दें, मैं कंट्रोल रूम से सातो बोल रहा हूँ।",
      "दोपहर 2 बजे के शो के दरवाज़े 15 मिनट देर से, 2:15 बजे खुलेंगे।",
      "गेट 3 पर लगभग 300 मेहमान इंतज़ार कर रहे हैं, इसलिए गेट 5 से दो और लोगों को भेजिए।",
      "सुज़ुकी, कृपया हॉल B की 12वीं पंक्ति में व्हीलचेयर की जगहें देखकर बताइए।",
      "नरिता एयरपोर्ट से आने वाली बस ट्रैफ़िक में फँसी है और लगभग 2:40 बजे पहुँचेगी।",
      "कृपया उन मेहमानों को सीधे दूसरी मंज़िल के रिसेप्शन पर ले जाइए।",
      "अगर कुछ बदलता है, तो मैं चैनल 4 पर संपर्क करूँगा। धन्यवाद।",
    ],
  },
  id: {
    short: "Tanaka, tolong bawa 2 radio ke Gerbang 14.",
    long: "Kiriman 250 kursi dari Acme Logistics akan tiba di dok bongkar muat di belakang Hall B pukul 15.45, jadi siapkan tiga orang untuk membongkar dan mencocokkan jumlahnya dengan nomor pesanan 7082.",
    speech: [
      "Untuk semua staf, ini Sato dari ruang kontrol.",
      "Pintu untuk pertunjukan pukul 14.00 akan dibuka terlambat 15 menit, yaitu pukul 14.15.",
      "Sekitar 300 tamu sedang menunggu di Gerbang 3, jadi tolong kirim dua orang lagi dari Gerbang 5.",
      "Suzuki, tolong periksa tempat kursi roda di baris 12 Hall B lalu laporkan.",
      "Bus dari Bandara Narita terjebak macet dan akan tiba sekitar pukul 14.40.",
      "Tolong antar tamu-tamu itu langsung ke meja resepsionis di lantai 2.",
      "Kalau ada perubahan, saya akan menghubungi lewat saluran 4. Terima kasih.",
    ],
  },
  vi: {
    short: "Tanaka, làm ơn mang 2 bộ đàm đến cổng 14.",
    long: "Lô hàng 250 chiếc ghế của Acme Logistics sẽ đến bến bốc dỡ phía sau Hội trường B lúc 15 giờ 45, vì vậy hãy chuẩn bị ba người để dỡ hàng và đối chiếu số lượng với mã đơn hàng 7082.",
    speech: [
      "Gửi toàn thể nhân viên, tôi là Sato từ phòng điều khiển.",
      "Cửa vào buổi diễn lúc 14 giờ sẽ mở muộn 15 phút, tức là lúc 14 giờ 15.",
      "Có khoảng 300 khách đang chờ ở cổng 3, vì vậy hãy cử thêm hai người từ cổng 5.",
      "Suzuki, làm ơn kiểm tra chỗ dành cho xe lăn ở hàng 12 của Hội trường B rồi báo lại.",
      "Xe buýt từ sân bay Narita đang bị kẹt xe và sẽ đến khoảng 14 giờ 40.",
      "Hãy dẫn những vị khách đó thẳng đến quầy lễ tân ở tầng 2.",
      "Nếu có thay đổi, tôi sẽ liên lạc qua kênh 4. Cảm ơn.",
    ],
  },
};
