# Via + галерея вместо камеры

Патч браузера **Via 7.3.3 (20260823)**, `mark.via.gp`. Когда страница запрашивает съёмку
с камеры, открывается не камера, а галерея устройства: выбранное изображение уходит на сайт
так, как будто его только что сняли.

## Готовый APK

[`dist/Via_7.3.3_fakecam.apk`](dist/Via_7.3.3_fakecam.apk)

APK подписан новым ключом, поэтому поставить его «поверх» установленного из Google Play Via
не получится — сначала удалите оригинал.

## Что именно меняется

Срабатывание — только когда сайт явно требует съёмку, то есть у поля стоит атрибут `capture`:

```html
<input type="file" accept="image/*" capture="environment">
```

Обычная загрузка файла (`<input type="file">` без `capture`) работает как раньше — со штатным
диалогом выбора.

Все запросы на загрузку файлов приходят в обфусцированный фрагмент браузера
`Lc8/s6;->X(ValueCallback, FileChooserParams)` (это `WebChromeClient.onShowFileChooser`).
В начало метода добавлен вызов нового класса `mark.via.fakecam.FakeCamera`:

* `FileChooserParams.isCaptureEnabled()` ложно — возвращается `false`, дальше идёт
  нетронутый оригинальный код Via;
* иначе запускается выбор изображения с тем же кодом запроса `0x6f`, который Via уже
  использует для своего файлового диалога, поэтому результат разбирает штатный обработчик
  через `FileChooserParams.parseResult()`.

Какой экран галереи откроется, зависит от версии Android:

| Android | Способ |
| --- | --- |
| 13+ | системный фотопикер (`MediaStore.ACTION_PICK_IMAGES`) |
| ниже | галерея (`ACTION_PICK` по `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`) |
| запасной вариант | `ACTION_GET_CONTENT` с типом `image/*` |

Если сайт просит именно видео, подставляется видеогалерея. Любая ошибка внутри хука
приводит к возврату `false`, то есть к обычному поведению браузера.

## Сборка

```bash
./patch/build.sh
```

Скрипт распаковывает `Via_*_base_src.zip`, конвертирует метаданные APKTool M
(`apktool.json`) в формат Apktool (`apktool.yml`), компилирует `patch/src` в dex, переводит
его в smali, вставляет хук, собирает и подписывает APK в `dist/`. Apktool, baksmali и
Android SDK скачиваются при первом запуске в `~/.cache/via-fakecam`.

Состав каталога `patch/`:

| Путь | Назначение |
| --- | --- |
| `src/mark/via/fakecam/FakeCamera.java` | новый класс, открывающий галерею |
| `stubs/androidx/fragment/app/Fragment.java` | заглушка для сборки: в APK методы AndroidX переименованы R8 (`getContext` → `I`, `startActivityForResult` → `P2`) |
| `tools/json2yml.py` | конвертер метаданных APKTool M |
| `tools/inject_hook.py` | вставка вызова хука в smali |
