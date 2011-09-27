(function() {
  var BookReader2UpView;
  BookReader2UpView = (function() {
  
    function BookReader2UpView() {
      // should be a better way to do this...
      $.extend(this, {
        reader : null,
        container: null,
        reduce: 1,
        currentIndex : 0,
        currentIndexL : null,
        currentIndexR : null,
        prefetchedImgs : null,
        coverInternalPadding : 0, // Width of cover
        coverExternalPadding : 0, // Padding outside of cover
        bookSpineDivWidth : 64, // Width of book spine  $$$ consider sizing based on book length,
        autofit : 'auto',
        animatorClass : 'NaturalPageFlipAnimator'
      })
    }

    BookReader2UpView.prototype.init = function(reader, targetElement) {
  
      this.reader = reader;
      this.container = $(targetElement);
  
      this.prefetchedImgs = {};
  
      // subscribe to events
      $(this.reader.parentElement).bind("br_indexUpdated.bookreader2up", { self: this },
        function(e, params) {
          e.data.self.jumpToIndex(params.newIndex);
        }
      );

      $(this.reader.parentElement).bind("br_redraw.bookreader2up", { self: this },
        function(e, params) {
          e.data.self.refresh(params);
        }
      );

      $(this.reader.parentElement).bind("br_zoom.bookreader2up", { self: this },
        function(e, params) {
          e.data.self.zoom2up(params.direction);
        }
      );
    
    }

    BookReader2UpView.prototype.refresh = function(centerPercentageX, centerPercentageY) {
      // is this a method or an event?
      $(this.container).empty();
      $(this.container).css('overflow', 'auto');
  
      console.log("REFRESH CALLED");
  
      //var targetLeaf = this.displayedIndices[0];
      
      var targetLeaf = this.reader.currentIndex() || this.firstDisplayableIndex();

      if (targetLeaf < this.firstDisplayableIndex()) {
          targetLeaf = this.firstDisplayableIndex();
      }
  
      if (targetLeaf > this.lastDisplayableIndex()) {
          targetLeaf = this.lastDisplayableIndex();
      }
  
      var currentSpreadIndices = this.reader.getSpreadIndices(targetLeaf);
      this.currentIndexL = currentSpreadIndices[0];
      this.currentIndexR = currentSpreadIndices[1];
      //this.firstIndex = this.currentIndexL;
  
      this.calculateSpreadSize(); //sets twoPage.width, twoPage.height and others

      this.pruneUnusedImgs();
      this.prefetch(); // Preload images or reload if scaling has changed
  
      // Add the two page view
      // $$$ Can we get everything set up and then append?
      this.wrapped = $('<div id="BRtwopageview" style="border: 4px solid red"></div>').appendTo($(this.container));
  
      // Attaches to first child, so must come after we add the page view
      //$('#BRcontainer').dragscrollable();
      this.reader.bindGestures(this.container);

      // $$$ calculate first then set
      $(this.wrapped).css( {
          height: this.totalHeight + 'px',
          width: this.totalWidth + 'px',
          position: 'absolute'
          });
  
      // If there will not be scrollbars (e.g. when zooming out) we center the book
      // since otherwise the book will be stuck off-center
      if (this.totalWidth < $(this.wrapped).attr('clientWidth')) {
          centerPercentageX = 0.5;
      }
      if (this.totalHeight < $(this.wrapped).attr('clientHeight')) {
          centerPercentageY = 0.5;
      }

      this.twoPageCenterView(centerPercentageX, centerPercentageY);

      this.coverDiv = document.createElement('div');
      $(this.coverDiv).attr('id', 'BRbookcover').css({
          width:  this.bookCoverDivWidth + 'px',
          height: this.bookCoverDivHeight+'px',
          visibility: 'visible'
      }).appendTo(this.wrapped);

      this.leafEdgeR = document.createElement('div');
      this.leafEdgeR.className = 'BRleafEdgeR';
      $(this.leafEdgeR).css({
          width: this.leafEdgeWidthR + 'px',
          height: this.height + 'px',
          left: this.gutter+this.scaledWR+'px',
          top: this.bookCoverDivTop+this.coverInternalPadding+'px'
      }).appendTo(this.wrapped);

      this.leafEdgeL = document.createElement('div');
      this.leafEdgeL.className = 'BRleafEdgeL';
      $(this.leafEdgeL).css({
          width: this.leafEdgeWidthL + 'px',
          height: this.height + 'px',
          left: this.bookCoverDivLeft+this.coverInternalPadding+'px',
          top: this.bookCoverDivTop+this.coverInternalPadding+'px'
      }).appendTo(this.wrapped);

      div = document.createElement('div');
      $(div).attr('id', 'BRgutter').css({
          width:           this.bookSpineDivWidth+'px',
          height:          this.bookSpineDivHeight+'px',
          left:            (this.gutter - this.bookSpineDivWidth*0.5)+'px',
          top:             this.bookSpineDivTop+'px'
      }).appendTo(this.wrapped);

      this.prepareTwoPagePopUp();

      this.displayedIndices = [];
      this.draw();

      this.prefetch();
  
    }

    // lastDisplayableIndex
    //______________________________________________________________________________
    // Returns the index of the last visible page, dependent on the mode.
    // $$$ Currently we cannot display the front/back cover in 2-up and will need to update
    // this function when we can as pa  rt of https://bugs.launchpad.net/gnubook/+bug/296788
    BookReader2UpView.prototype.lastDisplayableIndex = function() {

        var lastIndex = this.reader.numLeafs - 1;
    
        if ('rl' != this.pageProgression) {
            // LTR
            if (this.reader.getPageSide(lastIndex) == 'R') {
                return lastIndex;
            } else {
                return lastIndex + 1;
            }
        } else {
            // RTL
            if (this.reader.getPageSide(lastIndex) == 'L') {
                return lastIndex;
            } else {
                return lastIndex + 1;
            }
        }
    }

    BookReader2UpView.prototype.firstDisplayableIndex = function() {

        if ('rl' != this.reader.pageProgression) {
            // LTR
            if (this.reader.getPageSide(0) == 'L') {
                return 0;
            } else {
                return -1;
            }
        } else {
            // RTL
            if (this.reader.getPageSide(0) == 'R') {
                return 0;
            } else {
                return -1;
            }
        }
    }

    BookReader2UpView.prototype.getIdealSpreadSize = function(firstIndex, secondIndex) {
        var ideal = {};

        // We check which page is closest to a "normal" page and use that to set the height
        // for both pages.  This means that foldouts and other odd size pages will be displayed
        // smaller than the nominal zoom amount.
        var canon5Dratio = 1.5;
    
        var first = {
            height: this.reader._getPageHeight(firstIndex),
            width: this.reader._getPageWidth(firstIndex)
        }
    
        var second = {
            height: this.reader._getPageHeight(secondIndex),
            width: this.reader._getPageWidth(secondIndex)
        }
        
        var firstIndexRatio  = first.height / first.width;
        var secondIndexRatio = second.height / second.width;
        //console.log('firstIndexRatio = ' + firstIndexRatio + ' secondIndexRatio = ' + secondIndexRatio);

        var ratio;
        if (Math.abs(firstIndexRatio - canon5Dratio) < Math.abs(secondIndexRatio - canon5Dratio)) {
            ratio = firstIndexRatio;
        } else {
            ratio = secondIndexRatio;
        }

        var totalLeafEdgeWidth = parseInt(this.reader.numLeafs * 0.1);
        var maxLeafEdgeWidth   = parseInt($(this.container).attr('clientWidth') * 0.1);
        ideal.totalLeafEdgeWidth     = Math.min(totalLeafEdgeWidth, maxLeafEdgeWidth);
    
        var widthOutsidePages = 2 * (this.coverInternalPadding + this.coverExternalPadding) + ideal.totalLeafEdgeWidth;
        var heightOutsidePages = 2* (this.coverInternalPadding + this.coverExternalPadding);
    
        ideal.width = ($(this.container).width() - widthOutsidePages) >> 1;
        ideal.width -= 10; // $$$ fudge factor
        ideal.height = $(this.container).height() - heightOutsidePages;
        ideal.height -= 20; // fudge factor
        //console.log('init idealWidth='+ideal.width+' idealHeight='+ideal.height + ' ratio='+ratio);

        if (ideal.height/ratio <= ideal.width) {
            //use height
            ideal.width = parseInt(ideal.height/ratio);
        } else {
            //use width
            ideal.height = parseInt(ideal.width*ratio);
        }
    
        // $$$ check this logic with large spreads
        ideal.reduce = ((first.height + second.height) / 2) / ideal.height;
    
        return ideal;
    }

    // getSpreadSizeFromReduce()
    //______________________________________________________________________________
    // Returns the spread size calculated from the reduction factor for the given pages
    BookReader2UpView.prototype.getSpreadSizeFromReduce = function(firstIndex, secondIndex, reduce) {
        var spreadSize = {};
        // $$$ Scale this based on reduce?
        var totalLeafEdgeWidth = parseInt(this.reader.numLeafs * 0.1);
        var maxLeafEdgeWidth   = parseInt($(this.container).attr('clientWidth') * 0.1); // $$$ Assumes leaf edge width constant at all zoom levels
        spreadSize.totalLeafEdgeWidth     = Math.min(totalLeafEdgeWidth, maxLeafEdgeWidth);

        // $$$ Possibly incorrect -- we should make height "dominant"
        var nativeWidth = this.reader._getPageWidth(firstIndex) + this.reader._getPageWidth(secondIndex);
        var nativeHeight = this.reader._getPageHeight(firstIndex) + this.reader._getPageHeight(secondIndex);
        spreadSize.height = parseInt( (nativeHeight / 2) / this.reduce );
        spreadSize.width = parseInt( (nativeWidth / 2) / this.reduce );
        spreadSize.reduce = reduce;
    
        return spreadSize;
    }

    // calculateSpreadSize()
    //______________________________________________________________________________
    // Calculates 2-page spread dimensions based on this.currentIndexL and
    // this.currentIndexR
    // This function sets this.height, twoPage.width

    BookReader2UpView.prototype.calculateSpreadSize = function() {

        var firstIndex  = this.currentIndexL;
        var secondIndex = this.currentIndexR;
        //console.log('first page is ' + firstIndex);

        // Calculate page sizes and total leaf width
        var spreadSize;
        if ( this.autofit) {    
            spreadSize = this.getIdealSpreadSize(firstIndex, secondIndex);
        } else {
            // set based on reduction factor
            spreadSize = this.getSpreadSizeFromReduce(firstIndex, secondIndex, this.reduce);
        }
        
        // Both pages together
        this.height = spreadSize.height;
        this.width = spreadSize.width;
    
        // Individual pages
        this.scaledWL = this.getPageWidth2UP(firstIndex);
        this.scaledWR = this.getPageWidth2UP(secondIndex);
    
        // Leaf edges
        this.edgeWidth = spreadSize.totalLeafEdgeWidth; // The combined width of both edges
        this.leafEdgeWidthL = this.leafEdgeWidth(this.currentIndexL);
        this.leafEdgeWidthR = this.edgeWidth - this.leafEdgeWidthL;
    
        this.gutter = this.middle + this.gutterOffsetForIndex(firstIndex);
    
        // Book cover
        // The width of the book cover div.  The combined width of both pages, twice the width
        // of the book cover internal padding (2*10) and the page edges
        this.bookCoverDivWidth = this.twoPageCoverWidth(this.scaledWL + this.scaledWR);
        // The height of the book cover div
        this.bookCoverDivHeight = this.height + 2 * this.coverInternalPadding;
    
    
        // We calculate the total width and height for the div so that we can make the book
        // spine centered
        var leftGutterOffset = this.gutterOffsetForIndex(firstIndex);
        var leftWidthFromCenter = this.scaledWL - leftGutterOffset + this.leafEdgeWidthL;
        var rightWidthFromCenter = this.scaledWR + leftGutterOffset + this.leafEdgeWidthR;
        var largestWidthFromCenter = Math.max( leftWidthFromCenter, rightWidthFromCenter );
        this.totalWidth = 2 * (largestWidthFromCenter + this.coverInternalPadding + this.coverExternalPadding);
        this.totalHeight = this.height + 2 * (this.coverInternalPadding + this.coverExternalPadding);
        
        // We want to minimize the unused space in two-up mode (maximize the amount of page
        // shown).  We give width to the leaf edges and these widths change (though the sum
        // of the two remains constant) as we flip through the book.  With the book
        // cover centered and fixed in the BRcontainer div the page images will meet
        // at the "gutter" which is generally offset from the center.
        this.middle = this.totalWidth >> 1;
        this.gutter = this.middle + this.gutterOffsetForIndex(firstIndex);
    
        // The left edge of the book cover moves depending on the width of the pages
        // $$$ change to getter
        this.bookCoverDivLeft = this.gutter - this.scaledWL - this.leafEdgeWidthL - this.coverInternalPadding;
        // The top edge of the book cover stays a fixed distance from the top
        this.bookCoverDivTop = this.coverExternalPadding;

        // Book spine
        this.bookSpineDivHeight = this.height + 2*this.coverInternalPadding;
        this.bookSpineDivLeft = this.middle - (this.bookSpineDivWidth >> 1);
        this.bookSpineDivTop = this.bookCoverDivTop;


        this.reduce = spreadSize.reduce; // $$$ really set this here?
    }

    // gutterOffsetForIndex
    //______________________________________________________________________________
    //
    // Returns the gutter offset for the spread containing the given index.
    // This function supports RTL
    BookReader2UpView.prototype.gutterOffsetForIndex = function(pindex) {

        // To find the offset of the gutter from the middle we calculate our percentage distance
        // through the book (0..1), remap to (-0.5..0.5) and multiply by the total page edge width
        var offset = parseInt(((pindex / this.reader.numLeafs) - 0.5) * this.edgeWidth);
    
        // But then again for RTL it's the opposite
        if ('rl' == this.reader.pageProgression) {
            offset = -offset;
        }
    
        return offset;
    }

    // leafEdgeWidth
    //______________________________________________________________________________
    // Returns the width of the leaf edge div for the page with index given
    BookReader2UpView.prototype.leafEdgeWidth = function(pindex) {
        // $$$ could there be single pixel rounding errors for L vs R?
        if ((this.reader.getPageSide(pindex) == 'L') && (this.reader.pageProgression != 'rl')) {
            return parseInt( (pindex/this.reader.numLeafs) * this.edgeWidth + 0.5);
        } else {
            return parseInt( (1 - pindex/this.reader.numLeafs) * this.edgeWidth + 0.5);
        }
    }

    BookReader2UpView.prototype.jumpToIndex = function(index) {
      // really needs to figure out if params.index is on R or L
      var currentSpreadIndices = this.reader.getSpreadIndices(index);
      this.animateFlip(currentSpreadIndices);
    }

    BookReader2UpView.prototype.right = function(params) {
      // figure out next index
      if ( this.currentIndexL + 2 > this.reader.numLeafs - 1 ) {
        // noop
        return;
      }
      var index = this.currentIndexL + 2;
  
      // send event
      br.jumpToIndex(index);
    }

    BookReader2UpView.prototype.left = function(params) {
      // figure out next index
      if ( this.currentIndexR - 2 < 0 ) {
        // noop
        return;
      }
      var index = this.currentIndexL - 2;
  
      br.jumpToIndex(index);
    }

    BookReader2UpView.prototype.animateFlip = function(spread) {
  
      var nextIndexL = spread[0];
      var nextIndexR = spread[1];
  
      var animator = new window[this.animatorClass](this);
      this.draw(nextIndexL, nextIndexR, true);
      animator.run(nextIndexL, nextIndexR, ( nextIndexL > this.currentIndexL ));
  
    }

    BookReader2UpView.prototype.flipComplete = function(nextIndexL, nextIndexR) {
      $(this.wrapped).find("#pagediv" + this.currentIndexL).remove();
      $(this.wrapped).find("#pagediv" + this.currentIndexR).remove();
      this.currentIndexL = nextIndexL;
      this.currentIndexR = nextIndexR;
      $(this.wrapped).find("#pagediv" + this.currentIndexL).css({zIndex: 2});
      $(this.wrapped).find("#pagediv" + this.currentIndexR).css({zIndex: 2});
      this.displayedIndices = [this.currentIndexL, this.currentIndexR];

      this.pruneUnusedImgs()
      this.prefetch();
    }

    // drawLeafsTwoPage()
    //______________________________________________________________________________
    BookReader2UpView.prototype.draw = function(indexL, indexR, isHidden) {
        var scrollTop = $(this.wrapped).attr('scrollTop');
        var scrollBottom = scrollTop + $(this.wrapped).height();
    
        // $$$ we should use calculated values in this.twoPage (recalc if necessary)
    
        indexL = indexL !== undefined ? indexL : this.currentIndexL;
        indexR = indexR !== undefined ? indexR : this.currentIndexR;
        
        var isHiddenL;
        var isHiddenR;
        var zIndexR, zIndexL;
        var zIndex = 2;
        
        zIndexR = zIndexL = zIndex;
        if ( isHidden ) {
          zIndexR = zIndexL = 1;
          if ( indexL > this.currentIndexL ) {
            // navigating forward
            isHiddenL = true;
            zIndexL = 3;
          } else {
            // navigating backward
            isHiddenR = true;
            zIndexR = 3;
          }
        }
        
        var heightL  = this.reader._getPageHeight(indexL); 
        var widthL   = this.reader._getPageWidth(indexL);

        var leafEdgeWidthL = this.leafEdgeWidth(indexL);
        var leafEdgeWidthR = this.edgeWidth - leafEdgeWidthL;
        //var bookCoverDivWidth = this.width*2 + 20 + this.edgeWidth; // $$$ hardcoded cover width
        var bookCoverDivWidth = this.bookCoverDivWidth;
        //console.log(leafEdgeWidthL);

        var middle = this.middle; // $$$ getter instead?
        var top = this.twoPageTop();
        var bookCoverDivLeft = this.bookCoverDivLeft;

        this.scaledWL = this.getPageWidth2UP(indexL);
        this.gutter = this.twoPageGutter();
    
        // $(this.wrapped).empty();
        // $(this.wrapped).find(".BRpageimage").remove();
    
        this.leftPage = $("<div class='page2up'></div>")
          .attr({ id : "pagediv" + indexL })
          .css({
            position: 'absolute',
            overflow: 'hidden',
            left : (isHiddenL ? ((this.gutter * 2) + 'px') : (this.gutter-this.scaledWL + 'px')),
            right : 'auto',
            top : top + 'px',
            height : this.height + 'px',
            width : isHiddenL ? 0 : this.scaledWL + 'px',
            zIndex : zIndexL
          })
    
        this.prefetchImg(indexL);
        $(this.prefetchedImgs[indexL])
          .appendTo(this.leftPage)
          //.css({ height : '100%', width : '100%' });
          .css({ height : this.height + 'px', width : this.scaledWL + 'px' });
        this.leftPage.appendTo(this.wrapped);
        
        // $(this.prefetchedImgs[indexL]).css({
        //     position: 'absolute',
        //     left: this.gutter-this.scaledWL+'px',
        //     right: '',
        //     top:    top+'px',
        //     height: this.height +'px', // $$$ height forced the same for both pages
        //     width:  this.scaledWL + 'px',
        //     zIndex: zIndex
        // }).appendTo(this.wrapped);
    
        var heightR  = this.reader._getPageHeight(indexR); 
        var widthR   = this.reader._getPageWidth(indexR);

        // $$$ should use getwidth2up?
        //var scaledWR = this.height*widthR/heightR;
        this.scaledWR = this.getPageWidth2UP(indexR);
    
        this.rightPage = $("<div class='page2up'></div>")
          .attr({ id : "pagediv" + indexR })
          .css({
            position: 'absolute',
            overflow: 'hidden',
            left : isHiddenR ? 0 : this.gutter + 'px',
            right : 'auto',
            top : top + 'px',
            height : this.height + 'px',
            width : isHiddenR ? 0 : this.scaledWR + 'px',
            zIndex : zIndexR
          })
    
    
        this.prefetchImg(indexR);
        $(this.prefetchedImgs[indexR])
          .appendTo(this.rightPage)
          //.css({ height : '100%', width : '100%' });
          .css({ height : this.height + 'px', width : this.scaledWR + 'px' });
          
        this.rightPage.appendTo(this.wrapped);
    
        // $(this.prefetchedImgs[indexR]).css({
        //     position: 'absolute',
        //     left:   this.gutter+'px',
        //     right: '',
        //     top:    top+'px',
        //     height: this.height + 'px', // $$$ height forced the same for both pages
        //     width:  this.scaledWR + 'px',
        //     zIndex: 2
        // }).appendTo(this.wrapped);
        
        this.setMouseHandlers2UP(indexL, indexR);
        this.twoPageSetCursor();

        //this.pruneUnusedImgs();
        this.prefetch(); // Preload images or reload if scaling has changed

    }

    // setMouseHandlers2UP
    //______________________________________________________________________________
    BookReader2UpView.prototype.setMouseHandlers2UP = function(indexL, indexR) {
      indexL = indexL !== undefined ? indexL : this.currentIndexL;
      indexR = indexR !== undefined ? indexR : this.currentIndexR;
        this.setClickHandler2UP( this.prefetchedImgs[indexL],
            { self: this },
            function(e) {
                if (e.which == 3) {
                    // right click
                    if (e.data.self.reader.protected) {
                        return false;
                    }
                    return true;
                }
                                        
                 if (! e.data.self.twoPageIsZoomedIn()) {
                    //e.data.self.reader.ttsStop();
                    e.data.self.left();                
                }
                e.preventDefault();
            }
        );
        
        this.setClickHandler2UP( this.prefetchedImgs[indexR],
            { self: this },
            function(e) {
                if (e.which == 3) {
                    // right click
                    if (e.data.self.reader.protected) {
                        return false;
                    }
                    return true;
                }
            
                if (! e.data.self.twoPageIsZoomedIn()) {
                    //e.data.self.ttsStop();
                    e.data.self.right();                
                }
                e.preventDefault();
            }
        );
    }

    BookReader2UpView.prototype.setClickHandler2UP = function( element, data, handler) {
        //console.log('setting handler');
        //console.log(element.tagName);
    
        $(element).unbind('click').bind('click', data, function(e) {
            handler(e);
        });
    }

    // twoPageIsZoomedIn
    //______________________________________________________________________________
    // Returns true if the pages extend past the edge of the view
    BookReader2UpView.prototype.twoPageIsZoomedIn = function() {
        var autofitReduce = this.twoPageGetAutofitReduce();
        var isZoomedIn = false;
        if (this.autofit != 'auto') {
            if (this.reduce < this.twoPageGetAutofitReduce()) {                
                isZoomedIn = true;
            }
        }
        return isZoomedIn;
    }

    // twoPageGetAutofitReduce()
    //______________________________________________________________________________
    // Returns the current ideal reduction factor
    BookReader2UpView.prototype.twoPageGetAutofitReduce = function() {
        var spreadSize = this.getIdealSpreadSize(this.currentIndexL, this.currentIndexR);
        return spreadSize.reduce;
    }

    // twoPageGutter()
    //______________________________________________________________________________
    // Returns the position of the gutter (line between the page images)
    BookReader2UpView.prototype.twoPageGutter = function() {
        return this.middle + this.gutterOffsetForIndex(this.currentIndexL);
    }

    // twoPageTop()
    //______________________________________________________________________________
    // Returns the offset for the top of the page images
    BookReader2UpView.prototype.twoPageTop = function() {
        return this.coverExternalPadding + this.coverInternalPadding; // $$$ + border?
    }

    // twoPageCoverWidth()
    //______________________________________________________________________________
    // Returns the width of the cover div given the total page width
    BookReader2UpView.prototype.twoPageCoverWidth = function(totalPageWidth) {
        return totalPageWidth + this.edgeWidth + 2*this.coverInternalPadding;
    }

    // twoPageGetViewCenter()
    //______________________________________________________________________________
    // Returns the percentage offset into twopageview div at the center of container div
    // { percentageX: float, percentageY: float }
    BookReader2UpView.prototype.twoPageGetViewCenter = function() {
        var center = {};

        var containerOffset = $(this.container).offset();
        var viewOffset = $(this.wrapped).offset();
        center.percentageX = (containerOffset.left - viewOffset.left + ($(this.container).attr('clientWidth') >> 1)) / this.totalWidth;
        center.percentageY = (containerOffset.top - viewOffset.top + ($(this.container).attr('clientHeight') >> 1)) / this.totalHeight;
    
        return center;
    }

    // twoPageCenterView(percentageX, percentageY)
    //______________________________________________________________________________
    // Centers the point given by percentage from left,top of twopageview
    BookReader2UpView.prototype.twoPageCenterView = function(percentageX, percentageY) {
        if ('undefined' == typeof(percentageX)) {
            percentageX = 0.5;
        }
        if ('undefined' == typeof(percentageY)) {
            percentageY = 0.5;
        }

        var viewWidth = $(this.wrapped).width();
        var containerClientWidth = $(this.container).attr('clientWidth');
        var intoViewX = percentageX * viewWidth;
    
        var viewHeight = $(this.wrapped).height();
        var containerClientHeight = $(this.container).attr('clientHeight');
        var intoViewY = percentageY * viewHeight;
    
        if (viewWidth < containerClientWidth) {
            // Can fit width without scrollbars - center by adjusting offset
            $(this.wrapped).css('left', (containerClientWidth >> 1) - intoViewX + 'px');    
        } else {
            // Need to scroll to center
            $(this.wrapped).css('left', 0);
            $(this.container).scrollLeft(intoViewX - (containerClientWidth >> 1));
        }
    
        if (viewHeight < containerClientHeight) {
            // Fits with scrollbars - add offset
            $(this.wrapped).css('top', (containerClientHeight >> 1) - intoViewY + 'px');
        } else {
            $(this.wrapped).css('top', 0);
            $(this.container).scrollTop(intoViewY - (containerClientHeight >> 1));
        }
    }

    // pruneUnusedImgs()
    //______________________________________________________________________________
    BookReader2UpView.prototype.pruneUnusedImgs = function() {
        //console.log('current: ' + this.currentIndexL + ' ' + this.currentIndexR);
        for (var key in this.prefetchedImgs) {
            //console.log('key is ' + key);
            if ((key != this.currentIndexL) && (key != this.currentIndexR)) {
                //console.log('removing key '+ key);
                $(this.prefetchedImgs[key]).remove();
            }
            if ((key < this.currentIndexL-4) || (key > this.currentIndexR+4)) {
                //console.log('deleting key '+ key);
                delete this.prefetchedImgs[key];
            }
        }
    }

    // prefetch()
    //______________________________________________________________________________
    BookReader2UpView.prototype.prefetch = function() {

        // $$$ We should check here if the current indices have finished
        //     loading (with some timeout) before loading more page images
        //     See https://bugs.edge.launchpad.net/bookreader/+bug/511391

        // prefetch visible pages first
        this.prefetchImg(this.currentIndexL);
        this.prefetchImg(this.currentIndexR);
        
        var adjacentPagesToLoad = 3;
    
        var lowCurrent = Math.min(this.currentIndexL, this.currentIndexR);
        var highCurrent = Math.max(this.currentIndexL, this.currentIndexR);
        
        var start = Math.max(lowCurrent - adjacentPagesToLoad, 0);
        var end = Math.min(highCurrent + adjacentPagesToLoad, this.numLeafs - 1);
    
        // Load images spreading out from current
        for (var i = 1; i <= adjacentPagesToLoad; i++) {
            var goingDown = lowCurrent - i;
            if (goingDown >= start) {
                this.prefetchImg(goingDown);
            }
            var goingUp = highCurrent + i;
            if (goingUp <= end) {
                this.prefetchImg(goingUp);
            }
        }

        /*
        var lim = this.currentIndexL-4;
        var i;
        lim = Math.max(lim, 0);
        for (i = lim; i < this.currentIndexL; i++) {
            this.prefetchImg(i);
        }
    
        if (this.numLeafs > (this.currentIndexR+1)) {
            lim = Math.min(this.currentIndexR+4, this.numLeafs-1);
            for (i=this.currentIndexR+1; i<=lim; i++) {
                this.prefetchImg(i);
            }
        }
        */
    }

    // prefetchImg()
    //______________________________________________________________________________
    BookReader2UpView.prototype.prefetchImg = function(index) {
        var pageURI = this.reader._getPageURI(index, BookReader.util.reduceFromHeight(this.reader.getPageHeight(index), this.height));

        // Load image if not loaded or URI has changed (e.g. due to scaling)
        var loadImage = false;
        if (undefined == this.prefetchedImgs[index]) {
            //console.log('no image for ' + index);
            loadImage = true;
        } else if (pageURI != this.prefetchedImgs[index].uri) {
            //console.log('uri changed for ' + index);
            loadImage = true;
        }
    
        if (loadImage) {
            //console.log('prefetching ' + index);
            var img = document.createElement("img");
            $(img).addClass('BRpageimage').addClass('BRnoselect');
            if (index < 0 || index > (this.reader.numLeafs - 1) ) {
                // Facing page at beginning or end, or beyond
                $(img).css({
                    'background-color': '#efefef'
                });
            }
            img.src = pageURI;
            img.uri = pageURI; // browser may rewrite src so we stash raw URI here
            this.prefetchedImgs[index] = img;
        }
    }

    // getPageWidth2UP()
    //______________________________________________________________________________
    BookReader2UpView.prototype.getPageWidth2UP = function(index) {
        // We return the width based on the dominant height
        var height  = this.reader._getPageHeight(index); 
        var width   = this.reader._getPageWidth(index);    
        return Math.floor(this.height*width/height); // $$$ we assume width is relative to current spread
    }    

    // twoPageSetCursor()
    //______________________________________________________________________________
    // Set the cursor for two page view
    BookReader2UpView.prototype.twoPageSetCursor = function() {
        // console.log('setting cursor');
        if ( ($(self.wrapped).width() > $(self.container).attr('clientWidth')) ||
             ($(self.wrapped).height() > $(self.container).attr('clientHeight')) ) {
            $(this.prefetchedImgs[this.currentIndexL]).css('cursor','move');
            $(this.prefetchedImgs[this.currentIndexR]).css('cursor','move');
        } else {
            $(this.prefetchedImgs[this.currentIndexL]).css('cursor','');
            $(this.prefetchedImgs[this.currentIndexR]).css('cursor','');
        }
    }

    // prepareTwoPagePopUp()
    //
    // This function prepares the "View Page n" popup that shows while the mouse is
    // over the left/right "stack of sheets" edges.  It also binds the mouse
    // events for these divs.
    //______________________________________________________________________________
    BookReader2UpView.prototype.prepareTwoPagePopUp = function() {

        this.twoPagePopUp = document.createElement('div');
        this.twoPagePopUp.className = 'BRtwoPagePopUp';
        $(this.twoPagePopUp).css({
            zIndex: '1000'
        }).appendTo(this.container);
        $(this.twoPagePopUp).hide();
    
        $(this.leafEdgeL).add(this.leafEdgeR).bind('mouseenter', this, function(e) {
            $(e.data.twoPagePopUp).show();
        });

        $(this.leafEdgeL).add(this.leafEdgeR).bind('mouseleave', this, function(e) {
            $(e.data.twoPagePopUp).hide();
        });

        $(this.leafEdgeL).bind('click', this, function(e) { 
            // e.data.autoStop();
            // e.data.ttsStop();
            var jumpIndex = e.data.jumpIndexForLeftEdgePageX(e.pageX);
            $(e.data.container).trigger("bookreader.jumpToIndex", { index : jumpIndex });
            //e.data.jumpToIndex(jumpIndex);
        });

        $(this.leafEdgeR).bind('click', this, function(e) { 
            // e.data.autoStop();
            // e.data.ttsStop();
            var jumpIndex = e.data.jumpIndexForRightEdgePageX(e.pageX);
            $(e.data.container).trigger("bookreader.jumpToIndex", { index : jumpIndex });
            // e.data.jumpToIndex(jumpIndex);    
        });

        $(this.leafEdgeR).bind('mousemove', this, function(e) {

            var jumpIndex = e.data.jumpIndexForRightEdgePageX(e.pageX);
            $(e.data.twoPagePopUp).text('View ' + e.data.reader.getPageName(jumpIndex));
        
            // $$$ TODO: Make sure popup is positioned so that it is in view
            // (https://bugs.edge.launchpad.net/gnubook/+bug/327456)        
            $(e.data.twoPagePopUp).css({
                left: e.pageX- $(e.data.container).offset().left + $(e.data.container).scrollLeft() - 100 + 'px',
                top: e.pageY - $(e.data.container).offset().top + $(e.data.container).scrollTop() + 'px'
            });
        });

        $(this.leafEdgeL).bind('mousemove', this, function(e) {
    
            var jumpIndex = e.data.jumpIndexForLeftEdgePageX(e.pageX);
            $(e.data.twoPagePopUp).text('View '+ e.data.reader.getPageName(jumpIndex));

            // $$$ TODO: Make sure popup is positioned so that it is in view
            //           (https://bugs.edge.launchpad.net/gnubook/+bug/327456)        
            $(e.data.twoPagePopUp).css({
                left: e.pageX - $(e.data.container).offset().left + $(e.data.container).scrollLeft() - $(e.data.twoPagePopUp).width() + 100 + 'px',
                top: e.pageY-$(e.data.container).offset().top + $(e.data.container).scrollTop() + 'px'
            });
        });
    }

    // jumpIndexForLeftEdgePageX
    //______________________________________________________________________________
    // Returns the target jump leaf given a page coordinate (inside the left page edge div)
    BookReader2UpView.prototype.jumpIndexForLeftEdgePageX = function(pageX) {
        if ('rl' != this.pageProgression) {
            // LTR - flipping backward
            var jumpIndex = this.currentIndexL - ($(this.leafEdgeL).offset().left + $(this.leafEdgeL).width() - pageX) * 10;

            // browser may have resized the div due to font size change -- see https://bugs.launchpad.net/gnubook/+bug/333570        
            jumpIndex = BookReader.util.clamp(Math.round(jumpIndex), this.firstDisplayableIndex(), this.currentIndexL - 2);
            return jumpIndex;

        } else {
            var jumpIndex = this.currentIndexL + ($(this.leafEdgeL).offset().left + $(this.leafEdgeL).width() - pageX) * 10;
            jumpIndex = BookReader.util.clamp(Math.round(jumpIndex), this.currentIndexL + 2, this.lastDisplayableIndex());
            return jumpIndex;
        }
    }

    // jumpIndexForRightEdgePageX
    //______________________________________________________________________________
    // Returns the target jump leaf given a page coordinate (inside the right page edge div)
    BookReader2UpView.prototype.jumpIndexForRightEdgePageX = function(pageX) {
        if ('rl' != this.reader.pageProgression) {
            // LTR
            var jumpIndex = this.currentIndexR + (pageX - $(this.leafEdgeR).offset().left) * 10;
            jumpIndex = BookReader.util.clamp(Math.round(jumpIndex), this.currentIndexR + 2, this.lastDisplayableIndex());
            return jumpIndex;
        } else {
            var jumpIndex = this.currentIndexR - (pageX - $(this.leafEdgeR).offset().left) * 10;
            jumpIndex = BookReader.util.clamp(Math.round(jumpIndex), this.firstDisplayableIndex(), this.currentIndexR - 2);
            return jumpIndex;
        }
    }

    // zoom2up(direction)
    //______________________________________________________________________________
    BookReader2UpView.prototype.zoom2up = function(direction) {

        // Hard stop autoplay
        //this.stopFlipAnimations();
    
        // Recalculate autofit factors
        this.twoPageCalculateReductionFactors();
    
        // Get new zoom state
        var reductionFactor = BookReader.util.nextReduce(this.reduce, direction, this.reductionFactors);
        if ((this.reduce == reductionFactor.reduce) && (this.autofit == reductionFactor.autofit)) {
            // Same zoom
            return;
        }
        this.autofit = reductionFactor.autofit;
        this.reduce = reductionFactor.reduce;
        this.pageScale = this.reduce; // preserve current reduce

        // Preserve view center position
        var oldCenter = this.twoPageGetViewCenter();
    
        // If zooming in, reload imgs.  DOM elements will be removed by prepareTwoPageView
        // $$$ An improvement would be to use the low res image until the larger one is loaded.
        if (1 == direction) {
            for (var img in this.prefetchedImgs) {
                delete this.prefetchedImgs[img];
            }
        }
    
        // Prepare view with new center to minimize visual glitches
        //this.prepareTwoPageView(oldCenter.percentageX, oldCenter.percentageY);
        this.refresh(oldCenter.percentageX, oldCenter.percentageY);
    }

    BookReader2UpView.prototype.twoPageCalculateReductionFactors = function() {    
        this.reductionFactors = this.reader.reductionFactors.concat(
            [
                { reduce: this.getIdealSpreadSize( this.currentIndexL, this.currentIndexR ).reduce,
                  autofit: 'auto' }
            ]);
        this.reductionFactors.sort(this._reduceSort);
    }
    
    BookReader2UpView.prototype.hide = function() {
      return $(this.container).empty();
    };
    BookReader2UpView.prototype.show = function() {
      this.refresh();
      //return this.showCurrentIndex();
    };
    
    return BookReader2UpView;
  })();
    
  this.BookReader2UpView = BookReader2UpView;
  BookReader2UpView.params = {
    type: 'view',
    cssClass: 'redbox-2up-view'
  };
  BookReader.registerPlugin("redbox-2up-view", BookReader2UpView);
}).call(this);

////// animator classes

function ClassicPageFlipAnimator(view) {
  // should be a better way to do this...
  $.extend(this, {
    view : view,
    flipSpeed : "slow"
  })
}

ClassicPageFlipAnimator.prototype.run = function(nextIndexL, nextIndexR, isForward) {
  var self = this;
  
  self.newPageL = $("#pagediv" + nextIndexL);
  self.newPageR = $("#pagediv" + nextIndexR);
  self.currentPageL = $("#pagediv" + self.view.currentIndexL);
  self.currentPageR = $("#pagediv" + self.view.currentIndexR);
  
  if ( isForward ) {
    self.flipRightToLeft(nextIndexL, nextIndexR);
  } else {
    self.flipLeftToRight(nextIndexL, nextIndexR);
  }
}

ClassicPageFlipAnimator.prototype.flipRightToLeft = function(nextIndexL, nextIndexR) {

  var self = this;

  var middle = this.view.middle;    
  var gutter = middle + this.view.gutterOffsetForIndex(nextIndexL);

  var right = ($(self.view.wrapped).attr('clientWidth')-gutter);
  self.newPageL.css({ left: 'auto' }).css({ right : right+'px' });

  var oldLeafEdgeWidthL = this.view.leafEdgeWidth(this.view.currentIndexL);
  var oldLeafEdgeWidthR = this.view.edgeWidth-oldLeafEdgeWidthL;
  var newLeafEdgeWidthL = this.view.leafEdgeWidth(nextIndexL);  
  var newLeafEdgeWidthR = this.view.edgeWidth-newLeafEdgeWidthL;

  var leafEdgeTmpW = oldLeafEdgeWidthR - newLeafEdgeWidthR;

  var top = this.view.twoPageTop();
  var scaledW = this.view.getPageWidth2UP(this.view.currentIndexR);

  var currWidthL = this.view.getPageWidth2UP(this.view.currentIndexL);
  var currWidthR = this.view.getPageWidth2UP(this.view.currentIndexR);
  var newWidthL = this.view.getPageWidth2UP(nextIndexL);
  var newWidthR = this.view.getPageWidth2UP(nextIndexR);
  
  this.leafEdgeTmp = document.createElement('div');
  this.leafEdgeTmp.className = 'BRleafEdgeTmp';
  $(this.leafEdgeTmp).css({
      width: leafEdgeTmpW + 'px',
      height: this.view.height + 'px',
      left: gutter+scaledW+'px',
      top: top+'px',    
      zIndex:1000
  }).appendTo(this.view.wrapped);
  
  $(this.view.leafEdgeR).css({width: newLeafEdgeWidthR+'px', left: gutter+newWidthR+'px' });

  var speed = this.view.flipSpeed;

  var oldLeafEdgeWidthL = this.view.leafEdgeWidth(this.view.currentIndexL);
  var newLeafEdgeWidthL = this.view.leafEdgeWidth(nextIndexL);    
  var leafEdgeTmpW = oldLeafEdgeWidthL - newLeafEdgeWidthL;
  
  var currWidthL   = this.view.getPageWidth2UP(this.view.currentIndexL);
  var newWidthL    = this.view.getPageWidth2UP(nextIndexL);
  var newWidthR    = this.view.getPageWidth2UP(nextIndexR);

  var top  = this.view.twoPageTop();
  var gutter = this.view.middle + this.view.gutterOffsetForIndex(nextIndexL);

  $(this.leafEdgeTmp).animate({left: gutter}, self.flipSpeed, 'easeInSine');    
  self.currentPageR.animate({width: '0px'}, 
    { duration : self.flipSpeed, 
      easing : 'easeInSine', 
      step : function(now, fx) {
        $(fx.elem).children().css(fx.prop, now);
      },
      complete : function() {
    
      $('#BRgutter').css({left: (gutter - self.view.bookSpineDivWidth*0.5)+'px'});        
      $(self.leafEdgeTmp).animate({left: gutter-newWidthL-leafEdgeTmpW+'px'}, self.flipSpeed, 'easeOutSine');    
      
      //console.log('  animating newIndexR ' + newIndexR + ' to ' + newWidthR + ' from ' + $(self.prefetchedImgs[newIndexR]).width());
      self.newPageL.animate({width: newWidthL+'px'}, 
        { duration : self.flipSpeed, 
          easing : 'easeOutSine', 
          step : function(now, fx) {
            $(fx.elem).children().css(fx.prop, now);
          },
          complete : function() {
          self.newPageR.css('zIndex', 2);

          //jquery adds display:block to the element style, which interferes with our print css
          self.newPageR.css('display', '');
          self.newPageL.css('display', '');
          
          $(self.view.leafEdgeL).css({
              width: newLeafEdgeWidthL+'px', 
              left: gutter-newWidthL-newLeafEdgeWidthL+'px'
          });

          // Resizes the brown border div
          $(self.view.coverDiv).css({
              width: self.view.twoPageCoverWidth(newWidthL+newWidthR)+'px',
              left: gutter-newWidthL-newLeafEdgeWidthL-self.view.coverInternalPadding+'px'
          });            

          $(self.leafEdgeTmp).remove();
          self.leafEdgeTmp = null;
          
          // $$$ TODO refactor with opposite direction flip
          self.view.gutter = gutter;
          self.view.flipComplete(nextIndexL, nextIndexR);
          
      }});
  }});
  
}
   
ClassicPageFlipAnimator.prototype.flipLeftToRight = function(newIndexL, newIndexR) {
  
  var self = this;

  var leftLeaf = this.view.currentIndexL;
  
  var oldLeafEdgeWidthL = this.view.leafEdgeWidth(leftLeaf);
  var newLeafEdgeWidthL = this.view.leafEdgeWidth(newIndexL);    
  var leafEdgeTmpW = oldLeafEdgeWidthL - newLeafEdgeWidthL;
  
  var currWidthL   = this.view.getPageWidth2UP(leftLeaf);
  var newWidthL    = this.view.getPageWidth2UP(newIndexL);
  var newWidthR    = this.view.getPageWidth2UP(newIndexR);

  var top  = this.view.twoPageTop();
  var gutter = this.view.middle + this.view.gutterOffsetForIndex(newIndexL);
  
  // var rightCSS = {
  //      position: 'absolute',
  //      left:   gutter+'px',
  //      right: '',
  //      top:    top+'px',
  //      height: this.twoPage.height,
  //      width:  '0',
  //      zIndex: 2
  //  }
  
   self.newPageR.css({ right: 'auto' }).css({ left : gutter+'px' });
  
  
  //console.log('leftEdgeTmpW ' + leafEdgeTmpW);
  //console.log('  gutter ' + gutter + ', scaledWL ' + scaledWL + ', newLeafEdgeWL ' + newLeafEdgeWidthL);
  
  //animation strategy:
  // 0. remove search highlight, if any.
  // 1. create a new div, called leafEdgeTmp to represent the leaf edge between the leftmost edge 
  //    of the left leaf and where the user clicked in the leaf edge.
  //    Note that if this function was triggered by left() and not a
  //    mouse click, the width of leafEdgeTmp is very small (zero px).
  // 2. animate both leafEdgeTmp to the gutter (without changing its width) and animate
  //    leftLeaf to width=0.
  // 3. When step 2 is finished, animate leafEdgeTmp to right-hand side of new right leaf
  //    (left=gutter+newWidthR) while also animating the new right leaf from width=0 to
  //    its new full width.
  // 4. After step 3 is finished, do the following:
  //      - remove leafEdgeTmp from the dom.
  //      - resize and move the right leaf edge (leafEdgeR) to left=gutter+newWidthR
  //          and width=twoPage.edgeWidth-newLeafEdgeWidthL.
  //      - resize and move the left leaf edge (leafEdgeL) to left=gutter-newWidthL-newLeafEdgeWidthL
  //          and width=newLeafEdgeWidthL.
  //      - resize the back cover (twoPage.coverDiv) to left=gutter-newWidthL-newLeafEdgeWidthL-10
  //          and width=newWidthL+newWidthR+twoPage.edgeWidth+20
  //      - move new left leaf (newIndexL) forward to zindex=2 so it can receive clicks.
  //      - remove old left and right leafs from the dom [pruneUnusedImgs()].
  //      - prefetch new adjacent leafs.
  //      - set up click handlers for both new left and right leafs.
  //      - redraw the search highlight.
  //      - update the pagenum box and the url.
  
  
  var leftEdgeTmpLeft = gutter - currWidthL - leafEdgeTmpW;

  this.leafEdgeTmp = document.createElement('div');
  this.leafEdgeTmp.className = 'BRleafEdgeTmp';
  $(this.leafEdgeTmp).css({
      width: leafEdgeTmpW + 'px',
      height: this.view.height + 'px',
      left: leftEdgeTmpLeft + 'px',
      top: top+'px',
      zIndex:1000
  }).appendTo(self.view.wrapped);
  
  //$(this.leafEdgeL).css('width', newLeafEdgeWidthL+'px');
  $(this.view.leafEdgeL).css({
      width: newLeafEdgeWidthL+'px', 
      left: gutter-currWidthL-newLeafEdgeWidthL+'px'
  });   

  // Left gets the offset of the current left leaf from the document
  var left = self.currentPageL.offset().left;
  // $$$ This seems very similar to the gutter.  May be able to consolidate the logic.
  var right = $(self.view.wrapped).attr('clientWidth')-left-self.currentPageL.width()+$(self.view.wrapped).offset().left-2+'px';
  
  // We change the left leaf to right positioning
  // $$$ This causes animation glitches during resize.  See https://bugs.edge.launchpad.net/gnubook/+bug/328327
  self.currentPageL.css({
      right: right,
      left: ''
  });

  $(this.leafEdgeTmp).animate({left: gutter}, this.flipSpeed, 'easeInSine');    
  //$(this.prefetchedImgs[leftLeaf]).animate({width: '0px'}, 'slow', 'easeInSine');
  
  var self = this;

  //console.log('animating leafLeaf ' + leftLeaf + ' to 0px');
  self.currentPageL.animate({width: '0px'}, {
    duration : self.flipSpeed, 
    easing : 'easeInSine', 
    step : function(now, fx) {
      $(fx.elem).children().css(fx.prop, now);
    },
    complete : function() {
  
      //console.log('     and now leafEdgeTmp to left: gutter+newWidthR ' + (gutter + newWidthR));
      $(self.leafEdgeTmp).animate({left: gutter+newWidthR+'px'}, self.flipSpeed, 'easeOutSine');
      
      $('#BRgutter').css({left: (gutter - self.view.bookSpineDivWidth*0.5)+'px'});        

      //console.log('  animating newIndexR ' + newIndexR + ' to ' + newWidthR + ' from ' + $(self.prefetchedImgs[newIndexR]).width());
      self.newPageR.animate({width: newWidthR+'px'}, 
        { duration : self.flipSpeed, 
          easing : 'easeOutSine', 
          step : function(now, fx) {
            $(fx.elem).children().css(fx.prop, now);
          },
          complete : function() {
          self.newPageL.css('zIndex', 2);

          //jquery adds display:block to the element style, which interferes with our print css
          self.newPageL.css('display', '');
          self.newPageR.css('display', '');
          
          $(self.view.leafEdgeR).css({
              // Moves the right leaf edge
              width: self.view.edgeWidth-newLeafEdgeWidthL+'px',
              left:  gutter+newWidthR+'px'
          });

          $(self.view.leafEdgeL).css({
              // Moves and resizes the left leaf edge
              width: newLeafEdgeWidthL+'px',
              left:  gutter-newWidthL-newLeafEdgeWidthL+'px'
          });

          // Resizes the brown border div
          $(self.view.coverDiv).css({
              width: self.view.twoPageCoverWidth(newWidthL+newWidthR)+'px',
              left: gutter-newWidthL-newLeafEdgeWidthL-self.view.coverInternalPadding+'px'
          });            
          
          $(self.leafEdgeTmp).remove();
          self.leafEdgeTmp = null;

          // $$$ TODO refactor with opposite direction flip
          
          self.view.gutter = gutter;
          self.view.flipComplete(newIndexL, newIndexR);
          
      }});
  }});        

}


function NaturalPageFlipAnimator(view) {
  // should be a better way to do this...
  $.extend(this, {
    view : view,
    flipSpeed : "slow"
  })
}

NaturalPageFlipAnimator.prototype.run = function(nextIndexL, nextIndexR, isForward) {
  var self = this;
  
  self.newPageL = $("#pagediv" + nextIndexL);
  self.newPageR = $("#pagediv" + nextIndexR);
  self.currentPageL = $("#pagediv" + self.view.currentIndexL);
  self.currentPageR = $("#pagediv" + self.view.currentIndexR);
  
  if ( isForward ) {
    self.flipRightToLeft(nextIndexL, nextIndexR);
  } else {
    self.flipLeftToRight(nextIndexL, nextIndexR);
  }
}

NaturalPageFlipAnimator.prototype.flipRightToLeft = function(nextIndexL, nextIndexR) {

  var self = this;

  var middle = this.view.middle;    
  var gutter = middle + this.view.gutterOffsetForIndex(nextIndexL);
  
  var newWidthL    = this.view.getPageWidth2UP(nextIndexL);
  var currentWidthR = this.view.getPageWidth2UP(this.view.currentPageR);
  var canvas_width = $(this.view.wrapped).width();

  self.newPageR.css({ zIndex : 1 });
  
  self.currentPageR.stop().animate({width:0, left:currentWidthR}, self.flipSpeed, "easeInQuad");
  self.newPageL
        .stop()
        .addClass("flipRightToLeft")
        .animate({ left : canvas_width / 4, width: canvas_width / 4 }, self.flipSpeed, "easeInQuad")
        .animate({ left: 0, width: newWidthL}, self.flipSpeed, function() {
          self.currentPageL.stop()
          self.newPageL.removeClass("flipRightToLeft");
          self.view.flipComplete(nextIndexL, nextIndexR);
        });

  
}
   
NaturalPageFlipAnimator.prototype.flipLeftToRight = function(nextIndexL, nextIndexR) {

  var self = this;

  var middle = this.view.middle;    
  var gutter = middle + this.view.gutterOffsetForIndex(nextIndexL);
  
  var newWidthR    = this.view.getPageWidth2UP(nextIndexR);
  var currentWidthL = this.view.getPageWidth2UP(this.view.currentPageL);
  var canvas_width = $(this.view.wrapped).width();

  self.newPageL.css({ zIndex : 1 });
  self.newPageR.css({ zIndex : 9 });

  self.currentPageL.stop().animate({left:currentWidthL, width: 0}, 1200, "easeInOutQuad");
  self.newPageR
        .stop()
        .addClass("flipLeftToRight")
        .animate({ left : canvas_width / 4, width: canvas_width / 4 }, self.flipSpeed, "easeInQuad")
        .animate({ left: gutter, width: newWidthR }, self.flipSpeed, "easeOutQuad", function() {
          self.currentPageL.stop();
          self.newPageR.removeClass("flipLeftToRight");
          self.view.flipComplete(nextIndexL, nextIndexR);
        });

  
}
   
