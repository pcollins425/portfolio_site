const fallingObject = document.querySelector(".falling-object");
const falling = document.getElementById("falling");

let position = 0;

function fall() {
  position++;
  fallingObject.style.top = `${position}px`;
  if (position >= falling.clientHeight) {
    position = 0;
  }
}

setInterval(fall, 10);

// This code uses the querySelector function to select the div element with the class falling-object, 
// and the getElementById function to select the div element with the id falling. 
// It then defines a top variable and sets it to 0.

// The fall function increments the top variable by 1 and sets the top style property of the fallingObject element to the current value of top. 
// If top is greater than or equal to the height of the falling element, it sets top back to 0.

// The setInterval function is then used to execute the fall function every 10 milliseconds, 
// which causes the fallingObject element to fall continuously.