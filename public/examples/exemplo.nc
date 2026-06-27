; ModCNC - G-code de exemplo
; Retangulo arredondado 40x30 mm, cantos R5, 2 passes de profundidade.
; FACA UM AIR CUT PRIMEIRO: ferramenta acima da peca, ou sem fresa.
; Ajuste avancos (F), RPM (S) e profundidade (Z) para sua maquina/material.
G21          ; milimetros
G90          ; coordenadas absolutas
G17          ; plano XY
G0 Z5        ; altura segura
M3 S10000    ; liga spindle
G0 X5 Y0     ; ponto inicial

; ---- passe 1: Z-1 ----
G1 Z-1 F150
G1 X35 Y0 F500
G3 X40 Y5 I0 J5
G1 X40 Y25
G3 X35 Y30 I-5 J0
G1 X5 Y30
G3 X0 Y25 I0 J-5
G1 X0 Y5
G3 X5 Y0 I5 J0

; ---- passe 2: Z-2 ----
G1 Z-2 F150
G1 X35 Y0 F500
G3 X40 Y5 I0 J5
G1 X40 Y25
G3 X35 Y30 I-5 J0
G1 X5 Y30
G3 X0 Y25 I0 J-5
G1 X0 Y5
G3 X5 Y0 I5 J0

G0 Z5        ; sobe
M5           ; desliga spindle
G0 X0 Y0     ; volta a origem
