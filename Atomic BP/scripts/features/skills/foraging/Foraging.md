Objetivo: Terminar la implementación de las skills 

Se usara un sistema similar al de mining/ con la diferencia de que el texto a mostrar será diferente y además las recompensas variaran considerablemente, además habrá que acoplar regeneration/ a las necesidades actuales

Necesidades para que foraging funcione dentro de regeneration/ 

Foraging debe de hacer lo siguiente

Los jugadores tendrán la capacidad de talar logs de diversos tipos, sin importar el tipo de log se aplicaran (Mientras este dentro de la skill de foraging) efectos diversos de acuerdo a las estadisticas

Fortuna de Tala: Esta estadistica parecida a como se implemento la Fortuna de Mineria; Dará probabilidad y drops extra o diferentes dependiendo de la cantidad de Fortuna de la misma manera, si un jugador tiene 0 de Fortuna de Tala entonces se le dara el drop1, si tiene 10 de fortuna entonces con 10% de le dará el drop2 y con 90% el drop1; siguiendo casi exactamente la misma linea que Fortuna Minera

Frenesi de Tala: Esta estadistica la leemos dentro de lecture/ pero en regeneration/ es necesario implementar una nueva funcionalidad muy importante, que consiste como un efecto en cadena, si el bloque roto tiene un bloque adyacente (En cualquier lado, arriba, abajo, al lado, al otro lado, en total 6 posible posiciones ya que las diagonales no las contaremos porque no tienen contacto directo) El bloque adyacente tiene que ser del mismo tipo del roto, si el bloque roto es un bloque de carbón y hay otro bloque de carbón alado (Solo en ese caso) se activará el efecto de esta estadistica dependiendo de la cantidad de esta estadistica

Parecido a la Fortuna se ira escalando de 100 en 100 y será por posibilidad dependiendo, practicamente este es un efecto de picar en area, solo que 

Experiencia de Talado