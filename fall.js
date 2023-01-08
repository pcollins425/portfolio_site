const falling = document.getElementById("falling");

function createFallingObject() {
  const fallingObject = document.createElement("div");
  fallingObject.classList.add("falling-object");
  falling.appendChild(fallingObject);
 
  fallingObject.style.top = "-50px";
  fallingObject.style.left = `${Math.random() * 100}%`;
 
  function animateFallingObject() {
    const top = parseInt(fallingObject.style.top);
 
    if (top > falling.clientHeight) {
      fallingObject.style.top = "-50px";
    } else {
      fallingObject.style.top = `${top + 1}px`;
    }
 
    requestAnimationFrame(animateFallingObject);
  }
 
  animateFallingObject();
}
 
for (let i = 0; i < 5; i++) {
  createFallingObject();
}


// This code creates a container element called "falling" and then creates a function called createFallingObject that creates a falling object element, adds it to the container, and animates it using the requestAnimationFrame function. 
// The falling object element is given a random starting position on the x-axis and is positioned just above the top of the container. 
// The animateFallingObject function is called repeatedly using requestAnimationFrame, and it updates the position of the falling object element by incrementing its top style property. 
// If the falling object has reached the bottom of the container, its top property is reset to a value just above the top of the container, and the animation continues.

// Finally, the code creates 5 falling object elements by calling createFallingObject in a loop. You can adjust the number of falling object elements by changing the value in the for loop.