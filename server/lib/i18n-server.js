/* Server-side translation.

   The drift checker only sees L(en, hu) in the app bundle, so it was blind to a
   whole class of text: everything the SERVER writes. A Hungarian customer was
   getting "Cleaner assigned 🧹" as a push notification and "Booking failed" as an
   error, in English, no matter what language they use the app in.

   Two kinds of text are covered here:

     · NOTIFICATIONS — written by the server, read on the user's phone, often
       while the app is closed. These are translated HERE, using the recipient's
       stored language, because a push notification never passes through the app.

     · API ERRORS — returned to whichever client made the call. These stay in
       English on the wire (so logs, tests and 1.0 clients are unaffected) and are
       translated by the app at the moment it displays them, through the same
       dictionary the rest of the UI uses.

   Anything not in the table falls through as English, which is the correct
   behaviour for a message we have not translated yet — never a blank.        */

const LANGS = ["en", "hu", "de", "ro", "sk", "pl", "uk", "fr", "es", "it", "tr", "zh"];

/* Text the server sends to a person. Keyed by the exact English string, the same
   convention the client dictionaries use, so the two can never drift apart. */
const T = {
  /* ── booking lifecycle ── */
  "Cleaner assigned 🧹": { hu: "Takarító kijelölve 🧹", de: "Reinigungskraft zugewiesen 🧹", ro: "Curățător alocat 🧹", sk: "Pridelená upratovačka 🧹", pl: "Przydzielono sprzątającego 🧹", uk: "Призначено прибиральника 🧹", fr: "Intervenant assigné 🧹", es: "Limpiador asignado 🧹", it: "Addetto assegnato 🧹", tr: "Temizlik görevlisi atandı 🧹", zh: "已安排保洁员 🧹" },
  "Cleaning in progress ✨": { hu: "Takarítás folyamatban ✨", de: "Reinigung läuft ✨", ro: "Curățenie în curs ✨", sk: "Upratovanie prebieha ✨", pl: "Sprzątanie w toku ✨", uk: "Прибирання триває ✨", fr: "Nettoyage en cours ✨", es: "Limpieza en curso ✨", it: "Pulizia in corso ✨", tr: "Temizlik sürüyor ✨", zh: "保洁进行中 ✨" },
  "Job completed ✅": { hu: "Munka elkészült ✅", de: "Auftrag abgeschlossen ✅", ro: "Lucrare finalizată ✅", sk: "Zákazka dokončená ✅", pl: "Zlecenie ukończone ✅", uk: "Замовлення виконано ✅", fr: "Mission terminée ✅", es: "Servicio completado ✅", it: "Lavoro completato ✅", tr: "İş tamamlandı ✅", zh: "工作已完成 ✅" },
  "Job in ~40 minutes 🧹": { hu: "A takarítás kb. 40 perc múlva 🧹", de: "Auftrag in ca. 40 Minuten 🧹", ro: "Lucrare în ~40 de minute 🧹", sk: "Zákazka o ~40 minút 🧹", pl: "Zlecenie za ~40 minut 🧹", uk: "Замовлення через ~40 хвилин 🧹", fr: "Mission dans ~40 minutes 🧹", es: "Servicio en ~40 minutos 🧹", it: "Lavoro tra ~40 minuti 🧹", tr: "Yaklaşık 40 dakika sonra iş var 🧹", zh: "约 40 分钟后开始 🧹" },
  "Booking cancelled": { hu: "Foglalás lemondva", de: "Buchung storniert", ro: "Rezervare anulată", sk: "Rezervácia zrušená", pl: "Rezerwacja anulowana", uk: "Бронювання скасовано", fr: "Réservation annulée", es: "Reserva cancelada", it: "Prenotazione annullata", tr: "Randevu iptal edildi", zh: "预约已取消" },
  "Booking cancelled — refunded": { hu: "Foglalás lemondva — visszatérítve", de: "Buchung storniert — erstattet", ro: "Rezervare anulată — rambursată", sk: "Rezervácia zrušená — vrátené", pl: "Rezerwacja anulowana — zwrócono", uk: "Бронювання скасовано — кошти повернуто", fr: "Réservation annulée — remboursée", es: "Reserva cancelada — reembolsada", it: "Prenotazione annullata — rimborsata", tr: "Randevu iptal edildi — iade edildi", zh: "预约已取消 —— 已退款" },
  "Booking auto-cancelled": { hu: "Foglalás automatikusan lemondva", de: "Buchung automatisch storniert", ro: "Rezervare anulată automat", sk: "Rezervácia automaticky zrušená", pl: "Rezerwacja anulowana automatycznie", uk: "Бронювання скасовано автоматично", fr: "Réservation annulée automatiquement", es: "Reserva cancelada automáticamente", it: "Prenotazione annullata automaticamente", tr: "Randevu otomatik iptal edildi", zh: "预约已自动取消" },
  "A booking is waiting for you": { hu: "Egy foglalás vár rád", de: "Eine Buchung wartet auf Sie", ro: "O rezervare te așteaptă", sk: "Čaká na vás rezervácia", pl: "Czeka na Ciebie rezerwacja", uk: "На вас чекає бронювання", fr: "Une réservation vous attend", es: "Tienes una reserva esperando", it: "Una prenotazione ti aspetta", tr: "Seni bekleyen bir randevu var", zh: "有一个预约在等你处理" },

  /* ── the partner's invoice, emailed to the customer ── */
  "Your invoice": { hu: "A számlád", de: "Ihre Rechnung", ro: "Factura ta", sk: "Vaša faktúra", pl: "Twoja faktura", uk: "Ваш рахунок", fr: "Votre facture", es: "Tu factura", it: "La tua fattura", tr: "Faturan", zh: "你的发票" },
  "Hello": { hu: "Szia", de: "Hallo", ro: "Bună", sk: "Dobrý deň", pl: "Cześć", uk: "Вітаємо", fr: "Bonjour", es: "Hola", it: "Ciao", tr: "Merhaba", zh: "你好" },
  "has issued your invoice for booking": { hu: "kiállította a számlát ehhez a foglaláshoz:", de: "hat Ihre Rechnung ausgestellt für Buchung", ro: "a emis factura pentru rezervarea", sk: "vystavil faktúru k rezervácii", pl: "wystawił fakturę do rezerwacji", uk: "виставив рахунок за бронювання", fr: "a émis votre facture pour la réservation", es: "ha emitido tu factura de la reserva", it: "ha emesso la tua fattura per la prenotazione", tr: "şu rezervasyon için faturanı kesti:", zh: "已为以下预约开具发票" },
  "Invoice number": { hu: "Számlaszám", de: "Rechnungsnummer", ro: "Număr factură", sk: "Číslo faktúry", pl: "Numer faktury", uk: "Номер рахунку", fr: "Numéro de facture", es: "Número de factura", it: "Numero fattura", tr: "Fatura numarası", zh: "发票号" },
  "Issued": { hu: "Kiállítva", de: "Ausgestellt", ro: "Emisă", sk: "Vystavené", pl: "Wystawiono", uk: "Виставлено", fr: "Émise le", es: "Emitida", it: "Emessa", tr: "Kesim tarihi", zh: "开具日期" },
  "The invoice is attached to this email.": { hu: "A számlát csatoltuk ehhez az e-mailhez.", de: "Die Rechnung ist dieser E-Mail beigefügt.", ro: "Factura este atașată acestui e-mail.", sk: "Faktúra je priložená k tomuto e-mailu.", pl: "Faktura jest załączona do tej wiadomości.", uk: "Рахунок додано до цього листа.", fr: "La facture est jointe à cet e-mail.", es: "La factura está adjunta a este correo.", it: "La fattura è allegata a questa email.", tr: "Fatura bu e-postaya eklidir.", zh: "发票已作为附件随此邮件发送。" },
  "You can view it in the Cleano app.": { hu: "A Cleano alkalmazásban tudod megnézni.", de: "Sie können sie in der Cleano-App ansehen.", ro: "O poți vedea în aplicația Cleano.", sk: "Môžete si ju pozrieť v aplikácii Cleano.", pl: "Możesz ją zobaczyć w aplikacji Cleano.", uk: "Ви можете переглянути його в застосунку Cleano.", fr: "Vous pouvez la consulter dans l'application Cleano.", es: "Puedes verla en la aplicación Cleano.", it: "Puoi vederla nell'app Cleano.", tr: "Cleano uygulamasından görüntüleyebilirsin.", zh: "你可以在 Cleano 应用中查看。" },
  "This invoice is issued by the cleaning company, not by Cleano.": { hu: "A számlát a takarítócég állította ki, nem a Cleano.", de: "Diese Rechnung stellt das Reinigungsunternehmen aus, nicht Cleano.", ro: "Factura este emisă de firma de curățenie, nu de Cleano.", sk: "Faktúru vystavuje upratovacia firma, nie Cleano.", pl: "Fakturę wystawia firma sprzątająca, nie Cleano.", uk: "Рахунок виставляє клінінгова компанія, а не Cleano.", fr: "Cette facture est émise par l'entreprise de nettoyage, pas par Cleano.", es: "Esta factura la emite la empresa de limpieza, no Cleano.", it: "Questa fattura è emessa dall'impresa di pulizie, non da Cleano.", tr: "Bu fatura Cleano tarafından değil, temizlik şirketi tarafından kesilmiştir.", zh: "该发票由保洁公司开具，而非 Cleano。" },

  /* ── money ── */
  "Card charge failed": { hu: "A kártyás fizetés nem sikerült", de: "Kartenzahlung fehlgeschlagen", ro: "Plata cu cardul a eșuat", sk: "Platba kartou zlyhala", pl: "Płatność kartą nie powiodła się", uk: "Оплата карткою не пройшла", fr: "Le paiement par carte a échoué", es: "El pago con tarjeta ha fallado", it: "Pagamento con carta non riuscito", tr: "Kart ödemesi başarısız", zh: "银行卡扣款失败" },
  "Your invoice is ready": { hu: "Elkészült a számlád", de: "Ihre Rechnung ist fertig", ro: "Factura ta este gata", sk: "Vaša faktúra je pripravená", pl: "Twoja faktura jest gotowa", uk: "Ваш рахунок готовий", fr: "Votre facture est prête", es: "Tu factura está lista", it: "La tua fattura è pronta", tr: "Faturan hazır", zh: "你的发票已开具" },

  /* ── accounts ── */
  "Company approved ✅": { hu: "Cég jóváhagyva ✅", de: "Unternehmen freigegeben ✅", ro: "Firmă aprobată ✅", sk: "Firma schválená ✅", pl: "Firma zatwierdzona ✅", uk: "Компанію схвалено ✅", fr: "Entreprise approuvée ✅", es: "Empresa aprobada ✅", it: "Azienda approvata ✅", tr: "Firma onaylandı ✅", zh: "公司已通过审核 ✅" },
  "Account approved 🎓": { hu: "Fiók jóváhagyva 🎓", de: "Konto freigegeben 🎓", ro: "Cont aprobat 🎓", sk: "Účet schválený 🎓", pl: "Konto zatwierdzone 🎓", uk: "Обліковий запис схвалено 🎓", fr: "Compte approuvé 🎓", es: "Cuenta aprobada 🎓", it: "Account approvato 🎓", tr: "Hesap onaylandı 🎓", zh: "账户已通过审核 🎓" },
  "New cleaner waiting for approval": { hu: "Új takarító vár jóváhagyásra", de: "Neue Reinigungskraft wartet auf Freigabe", ro: "Un curățător nou așteaptă aprobarea", sk: "Nová upratovačka čaká na schválenie", pl: "Nowy sprzątający czeka na zatwierdzenie", uk: "Новий прибиральник очікує схвалення", fr: "Un nouvel intervenant attend une validation", es: "Un nuevo limpiador espera aprobación", it: "Un nuovo addetto attende approvazione", tr: "Onay bekleyen yeni temizlik görevlisi", zh: "有新的保洁员等待审核" },

  /* ── support ── */
  "A complaint needs your attention": { hu: "Egy panasz a figyelmedet várja", de: "Eine Beschwerde braucht Ihre Aufmerksamkeit", ro: "O reclamație are nevoie de atenția ta", sk: "Sťažnosť si vyžaduje vašu pozornosť", pl: "Skarga wymaga Twojej uwagi", uk: "Скарга потребує вашої уваги", fr: "Une réclamation demande votre attention", es: "Una reclamación necesita tu atención", it: "Un reclamo richiede la tua attenzione", tr: "Bir şikâyet ilgini bekliyor", zh: "有一条投诉需要处理" },
  "A report was handed to you": { hu: "Egy bejelentést hozzád rendeltek", de: "Ihnen wurde eine Meldung zugewiesen", ro: "Ți-a fost repartizată o sesizare", sk: "Bolo vám pridelené hlásenie", pl: "Przydzielono Ci zgłoszenie", uk: "Вам передали звернення", fr: "Un signalement vous a été confié", es: "Se te ha asignado una incidencia", it: "Ti è stata assegnata una segnalazione", tr: "Sana bir bildirim iletildi", zh: "有一条反馈转交给你" },
};

/* Normalise whatever we were handed into one of our language codes. */
export function normLang(lang) {
  const l = String(lang || "").slice(0, 2).toLowerCase();
  return LANGS.includes(l) ? l : "en";
}

/* Translate one server string. Unknown text falls through untouched — an
   untranslated message is far better than an empty notification. */
export function tr(lang, text) {
  const l = normLang(lang);
  if (l === "en") return text;
  const row = T[text];
  return (row && row[l]) || text;
}

/* The languages we can actually serve, for tests and tooling. */
export const serverLangs = () => [...LANGS];
export const serverStrings = () => Object.keys(T);
