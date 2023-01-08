const falling = document.getElementById("falling");
const fallingObjects = document.querySelectorAll(".falling-object");

let position = 0;

function moveCarousel() {
  position--;
  falling.style.left = `${position}px`;
  if (position <= -fallingObjects[0].clientWidth) {
    position = 0;
  }
}

setInterval(moveCarousel, 10);