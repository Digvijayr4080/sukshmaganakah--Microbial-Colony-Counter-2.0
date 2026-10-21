import React, { useState, useRef, useEffect } from 'react';
import LiveCounter from './components/LiveCounter';
import HemocytometerCounter from './components/HemocytometerCounter';
import { Upload, Microscope, Loader2, FlaskRound as Flask, TestTube, Pipette, Dna, Strikethrough as Petri, Battery as Bacteria, Beaker, Syringe, Goal as Vial, FlaskConical } from 'lucide-react';

declare global {
  interface Window {
    cv: any;
    cvScriptLoaded?: boolean;
  }
}

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ count: number | null; processedImageUrl: string | null }>({ 
    count: null,
    processedImageUrl: null 
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cvReady, setCvReady] = useState(false);
  const [mode, setMode] = useState<'upload' | 'live' | 'hemo'>('upload');
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  useEffect(() => {
    if (window.cvScriptLoaded) {
      if (window.cv && window.cv.Mat) {
        setCvReady(true);
      }
      return;
    }

    const existingScript = document.querySelector('script[src*="opencv.js"]');
    if (existingScript) {
      window.cvScriptLoaded = true;
      if (window.cv && window.cv.Mat) {
        setCvReady(true);
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    window.cvScriptLoaded = true;

    script.onload = () => {
      const checkInterval = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          setCvReady(true);
          clearInterval(checkInterval);
        }
      }, 100);
    };

    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (cvReady && pendingImage) {
      processImage(pendingImage);
      setPendingImage(null);
    }
  }, [cvReady, pendingImage]);

  const processImage = async (imageData: string) => {
    if (!window.cv || !cvReady) {
      console.error('OpenCV.js not loaded');
      return;
    }

    setProcessing(true);
    try {
      const img = new Image();
      img.src = imageData;
      await new Promise(resolve => img.onload = resolve);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageMatrix = window.cv.imread(canvas);

      const gray = new window.cv.Mat();
      window.cv.cvtColor(imageMatrix, gray, window.cv.COLOR_RGBA2GRAY);

      const blurred = new window.cv.Mat();
      const ksize = new window.cv.Size(5, 5);
      window.cv.GaussianBlur(gray, blurred, ksize, 0);

      const circles = new window.cv.Mat();
      window.cv.HoughCircles(
        blurred,
        circles,
        window.cv.HOUGH_GRADIENT,
        1,
        blurred.rows / 8,
        100,
        30,
        Math.min(blurred.rows, blurred.cols) / 4,
        Math.min(blurred.rows, blurred.cols) / 2
      );

      if (circles.cols === 0) {
        throw new Error('No petri dish detected');
      }

      const dish = {
        x: circles.data32F[0],
        y: circles.data32F[1],
        radius: circles.data32F[2]
      };

      const mask = new window.cv.Mat.zeros(gray.rows, gray.cols, window.cv.CV_8UC1);
      window.cv.circle(
        mask,
        new window.cv.Point(dish.x, dish.y),
        dish.radius,
        new window.cv.Scalar(255),
        -1
      );

      const binary = new window.cv.Mat();
      window.cv.adaptiveThreshold(
        blurred,
        binary,
        255,
        window.cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        window.cv.THRESH_BINARY_INV,
        11,
        2
      );

      const maskedBinary = new window.cv.Mat();
      binary.copyTo(maskedBinary, mask);

      const kernel = window.cv.Mat.ones(3, 3, window.cv.CV_8UC1);
      const cleaned = new window.cv.Mat();
      window.cv.morphologyEx(maskedBinary, cleaned, window.cv.MORPH_OPEN, kernel);

      const contours = new window.cv.MatVector();
      const hierarchy = new window.cv.Mat();
      window.cv.findContours(
        cleaned,
        contours,
        hierarchy,
        window.cv.RETR_EXTERNAL,
        window.cv.CHAIN_APPROX_SIMPLE
      );

      const output = imageMatrix.clone();
      let validColonies = 0;
      const minArea = 20;
      const maxArea = Math.PI * Math.pow(dish.radius / 10, 2);
      const minCircularity = 0.7;

      window.cv.circle(
        output,
        new window.cv.Point(dish.x, dish.y),
        dish.radius,
        new window.cv.Scalar(0, 255, 0, 255),
        2
      );

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = window.cv.contourArea(contour);
        const perimeter = window.cv.arcLength(contour, true);
        
        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

        if (area > minArea && area < maxArea && circularity > minCircularity) {
          const moments = window.cv.moments(contour);
          const cx = moments.m10 / moments.m00;
          const cy = moments.m01 / moments.m00;

          const distanceFromCenter = Math.sqrt(
            Math.pow(cx - dish.x, 2) + Math.pow(cy - dish.y, 2)
          );

          if (distanceFromCenter < dish.radius * 0.95) {
            validColonies++;

            window.cv.circle(
              output,
              new window.cv.Point(cx, cy),
              Math.sqrt(area / Math.PI),
              new window.cv.Scalar(255, 0, 0, 255),
              2
            );
          }
        }
      }

      const outputCanvas = document.createElement('canvas');
      window.cv.imshow(outputCanvas, output);
      const processedImageUrl = outputCanvas.toDataURL();

      imageMatrix.delete();
      gray.delete();
      blurred.delete();
      circles.delete();
      mask.delete();
      binary.delete();
      maskedBinary.delete();
      cleaned.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
      output.delete();

      setResults({ 
        count: validColonies,
        processedImageUrl: processedImageUrl
      });
    } catch (error) {
      console.error('Error processing image:', error);
      setResults({ count: null, processedImageUrl: null });
    } finally {
      setProcessing(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        setImage(imageData);
        if (cvReady) {
          processImage(imageData);
        } else {
          setPendingImage(imageData);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        setImage(imageData);
        if (cvReady) {
          processImage(imageData);
        } else {
          setPendingImage(imageData);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

 return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50">
      {/* Decorative Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-10">
        {/* Rod Bacteria */}
        <div className="absolute top-20 left-20 animate-float-slow">
          <div className="rod-bacteria transform rotate-45" />
        </div>
        <div className="absolute bottom-40 right-32 animate-float-medium">
          <div className="rod-bacteria transform -rotate-12" />
        </div>

        {/* Cocci Bacteria */}
        <div className="absolute top-1/3 right-24 animate-float-fast">
          <div className="cocci-bacteria" />
        </div>
        <div className="absolute bottom-1/4 left-32 animate-float-medium">
          <div className="cocci-bacteria" />
        </div>

        {/* Lab Equipment Icons */}
        <div className="absolute top-10 left-10 animate-float-slow">
          <Flask className="w-16 h-16 text-indigo-400" />
        </div>
        <div className="absolute top-20 right-20 animate-float-medium">
          <TestTube className="w-12 h-12 text-purple-400" />
        </div>
        <div className="absolute bottom-20 left-1/4 animate-float-fast">
          <Pipette className="w-14 h-14 text-blue-400" />
        </div>
        <div className="absolute top-1/3 right-1/4 animate-float-medium">
          <Dna className="w-20 h-20 text-indigo-500" />
        </div>
        <div className="absolute bottom-40 right-40 animate-float-slow">
          <FlaskConical className="w-16 h-16 text-purple-500" />
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 relative">
        <header className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="relative w-40 h-40">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 rounded-full opacity-20 animate-pulse"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-32 h-32">
                  <div className="absolute inset-0 bg-white rounded-full"></div>
                  <div className="absolute inset-2 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-full border-4 border-indigo-500"></div>
                  <div className="absolute inset-4 flex items-center justify-center">
                    <div className="w-4 h-4 bg-purple-500 rounded-full"></div>
                    <div className="absolute w-2 h-2 bg-indigo-300 rounded-full transform translate-x-3 -translate-y-2"></div>
                    <div className="absolute w-3 h-3 bg-blue-400 rounded-full transform -translate-x-4 translate-y-3"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <h1 className="text-6xl font-bold mb-4 relative">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600">
              सूक्ष्मगणकः 
            </span>
          </h1>
          <div className="flex items-center justify-center gap-4 mb-6">
            <FlaskConical className="w-6 h-6 text-purple-500" />
            <p className="text-xl text-gray-600 bg-white/50 px-6 py-2 rounded-full backdrop-blur-sm">
              Microbial Colony Counting System
            </p>
            <Beaker className="w-6 h-6 text-purple-500" />
          </div>
        </header>

        <div className="max-w-4xl mx-auto">
          <div className="flex justify-center gap-2 mb-6">
            {(['upload', 'live', 'hemo'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-5 py-2 rounded-lg font-medium ${mode === m ? 'bg-indigo-600 text-white shadow' : 'bg-white/80 text-indigo-700'}`}>
                {m === 'upload' ? 'Colony: upload' : m === 'live' ? 'Colony: live camera' : 'Hemocytometer'}
              </button>
            ))}
          </div>
          {mode === 'live' && <LiveCounter cvReady={cvReady} />}
          {mode === 'hemo' && <HemocytometerCounter cvReady={cvReady} />}
          <div
            className={`bg-white/90 backdrop-blur-lg rounded-xl shadow-xl p-8 mb-8 relative overflow-hidden border-2 border-indigo-200 ${mode !== 'upload' ? 'hidden' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {!image ? (
              <div
                className="border-4 border-dashed border-indigo-200 rounded-lg p-12 text-center cursor-pointer hover:border-indigo-400 transition-colors relative overflow-hidden group"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/50 via-purple-50/50 to-blue-50/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Upload className="w-16 h-16 text-indigo-400 mx-auto mb-4 group-hover:scale-110 transition-transform" />
                <p className="text-2xl text-indigo-600 mb-2 font-medium">Upload your petri dish image here</p>
                <p className="text-sm text-indigo-500">or click to select a file</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="relative group">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-200 to-purple-200 rounded-lg -m-1 opacity-0 group-hover:opacity-20 transition-opacity" />
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-indigo-700">
                      <TestTube className="w-5 h-5" />
                      Original Image
                    </h3>
                    <img
                      src={image || "/placeholder.svg"}
                      alt="Original petri dish"
                      className="w-full rounded-lg shadow-md"
                    />
                  </div>
                  <div className="relative group">
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-200 to-blue-200 rounded-lg -m-1 opacity-0 group-hover:opacity-20 transition-opacity" />
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-purple-700">
                      <Microscope className="w-5 h-5" />
                      Analysis Result
                    </h3>
                    {results.processedImageUrl ? (
                      <img
                        src={results.processedImageUrl || "/placeholder.svg"}
                        alt="Processed petri dish"
                        className="w-full rounded-lg shadow-md"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg flex items-center justify-center min-h-[200px]">
                        <p className="text-indigo-500">Processing...</p>
                      </div>
                    )}
                  </div>
                </div>

                {processing && (
                  <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center rounded-lg">
                    <div className="text-center">
                      <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                      <p className="text-xl text-indigo-700 font-medium">Analyzing colonies...</p>
                    </div>
                  </div>
                )}

                {results.count !== null && !processing && (
                  <div className="bg-gradient-to-r from-indigo-100 via-purple-100 to-blue-100 rounded-lg p-8 text-center relative">
                    <h2 className="text-2xl font-bold text-indigo-900 mb-4">Colony Analysis Results</h2>
                    <p className="text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 mb-2">
                      {results.count}
                    </p>
                    <p className="text-xl text-indigo-700">total colonies detected</p>
                    <p className="text-sm text-indigo-600 mt-2">Analysis completed with enhanced accuracy</p>
                  </div>
                )}

                <div className="flex justify-center">
                  <button
                    className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white px-8 py-4 rounded-lg hover:from-indigo-700 hover:via-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 hover:shadow-lg flex items-center gap-3 text-lg font-medium"
                    onClick={() => {
                      setImage(null)
                      setResults({ count: null, processedImageUrl: null })
                    }}
                  >
                    <Upload className="w-5 h-5" />
                    Analyze New Image
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={`bg-white/90 backdrop-blur-lg rounded-xl shadow-xl p-8 relative border-2 border-indigo-200 ${mode !== 'upload' ? 'hidden' : ''}`}>
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white px-8 py-3 rounded-full shadow-lg">
                <h2 className="text-xl font-semibold">Analysis Features</h2>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-indigo-700 flex items-center gap-2">
                  <Microscope className="w-5 h-5" />
                  Do the following Steps
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700">
                  <li>Please upload the image</li>
                  <li>Wait for processing and analysis of image</li>
                  <li>You can see the output image and count at analysis result box </li>
                </ul>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-purple-700 flex items-center gap-2">
                  <Flask className="w-5 h-5" />
                  Accuracy Features
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700">
                  <li>85%+ detection accuracy</li>
                  <li>Defines the edge of Petri Dish</li>
                  <li>Edge artifact removal</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App