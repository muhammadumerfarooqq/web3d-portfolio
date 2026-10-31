---
anchor: xss-body
title: XSS body fixture
---
Plain <script>alert(1)</script> text.

<img src=x onerror=alert(1)>

[js link](javascript:alert(1)) and [JS upper](JAVASCRIPT:alert(1)) and [entity js](&#106;avascript:alert(1))

[data link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) and [vb link](vbscript:msgbox(1))

[protocol relative](//evil.example/x) and ![image](https://evil.example/pixel.png)

[safe external](https://example.com/page) [site link](/about) [anchor link](#about)
