'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { cn } from '@/lib/utils';
import { useForm, useFieldArray } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Loader2, MailCheck, RotateCw } from 'lucide-react';
import { Progress } from './ui/progress';
import { DetailedFormValues, detailedFormSchema } from './budget-request/schema';
import { WIZARD_STEPS } from './budget-request/wizard-steps';
import { ContactStep } from './budget-request/steps/ContactStep';
import { DemolitionStep } from './budget-request/steps/DemolitionStep';
import { BathroomStep } from './budget-request/steps/BathroomStep';
import { KitchenStep } from './budget-request/steps/KitchenStep';
import { CeilingsStep } from './budget-request/steps/CeilingsStep';
import { ElectricityStep } from './budget-request/steps/ElectricityStep';
import { CarpentryStep } from './budget-request/steps/CarpentryStep';
import { MultimediaStep } from './budget-request/steps/MultimediaStep';
import { SummaryStep } from './budget-request/steps/SummaryStep';
import { ProjectDefinitionStep } from './budget-request/steps/ProjectDefinitionStep';
import { WorkAreaStep } from './budget-request/steps/WorkAreaStep';
import { motion, AnimatePresence } from 'framer-motion';
import { createBudgetAction } from '@/actions/budget/create-budget.action';
import { BudgetGenerationLoading } from './budget-request/BudgetGenerationLoading';
import type { QualificationDecision } from '@/backend/lead/domain/lead';

type SubmissionOutcome = {
  leadId?: string;
  decision?: QualificationDecision;
};

export function BudgetRequestWizard({ t, services, onBack, isWidget = false }: { t: any, services: any, onBack: () => void, isWidget?: boolean }) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [direction, setDirection] = useState(1);
  const [submissionResult, setSubmissionResult] = useState<SubmissionOutcome | null>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);

  const form = useForm<DetailedFormValues>({
    resolver: zodResolver(detailedFormSchema),
    defaultValues: {
      name: '', email: '', phone: '', address: '',
      propertyType: 'residential',
      projectScope: 'integral',
      totalAreaM2: 0,
      numberOfRooms: 1,
      numberOfBathrooms: 1,
      partialScope: [],
      demolishPartitions: false,
      demolishPartitionsM2: 0,
      removeDoors: false,
      removeDoorsAmount: 0,
      hasElevator: false,
      furnitureRemoval: false,

      kitchen: { renovate: false, demolition: false, plumbing: false },
      installFalseCeiling: false,
      falseCeilingM2: 0,
      soundproofRoom: false,
      soundproofRoomM2: 0,
      renovateElectricalPanel: false,
      renovateInteriorDoors: false,
      installSlidingDoor: false,
      paintWalls: false,
      paintCeilings: false,
      removeGotele: false,
      installAirConditioning: false,
      renovateExteriorCarpentry: false,
      files: [],
    },
  });

  const { control, trigger, watch, reset, getValues, handleSubmit } = form;
  const { fields: bathroomFields, append: appendBathroom, remove: removeBathroom } = useFieldArray({ control, name: "bathrooms" });
  const { fields: bedroomFields, append: appendBedroom, remove: removeBedroom } = useFieldArray({ control, name: "electricalBedrooms" });

  const propertyType = watch('propertyType');
  const projectScope = watch('projectScope');
  const partialScope = watch('partialScope') || [];
  const numberOfBathrooms = watch('numberOfBathrooms') || 0;
  const numberOfRooms = watch('numberOfRooms') || 0;

  useEffect(() => {
    const desiredCount = numberOfBathrooms;
    const currentCount = bathroomFields.length;
    if (currentCount < desiredCount) {
      for (let i = currentCount; i < desiredCount; i++) {
        appendBathroom({ quality: 'basic', wallTilesM2: 0, floorM2: 0, installShowerTray: false, installShowerScreen: false, plumbing: false });
      }
    } else if (currentCount > desiredCount) {
      for (let i = currentCount; i > desiredCount; i--) {
        removeBathroom(i - 1);
      }
    }
  }, [numberOfBathrooms, appendBathroom, removeBathroom, bathroomFields.length]);

  useEffect(() => {
    const desiredCount = numberOfRooms;
    const currentCount = bedroomFields.length;
    if (currentCount < desiredCount) {
      for (let i = currentCount; i < desiredCount; i++) {
        appendBedroom({ sockets: 4, lights: 1 });
      }
    } else if (currentCount > desiredCount) {
      for (let i = currentCount; i > desiredCount; i--) {
        removeBedroom(i - 1);
      }
    }
  }, [numberOfRooms, appendBedroom, removeBedroom, bedroomFields.length]);

  useEffect(() => {
    if (progressContainerRef.current) {
      progressContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentStep]);


  const activeSteps = useMemo(() => {
    let baseSteps = WIZARD_STEPS;

    if (propertyType === 'residential') {
      baseSteps = baseSteps.filter(step => step.id !== 'workArea');
    } else { // commercial or office
      baseSteps = baseSteps.filter(step => !['bathroom', 'kitchen'].includes(step.id));
    }

    if (projectScope === 'partial') {
      const partialStepsToShow = ['contact', 'projectDefinition', ...partialScope, 'summary'];
      return baseSteps.filter(step => partialStepsToShow.includes(step.id));
    }

    return baseSteps;
  }, [propertyType, projectScope, partialScope]);


  const nextStep = async () => {
    const currentStepConfig = activeSteps[currentStep];
    const fieldsToValidate = currentStepConfig?.fields as (keyof DetailedFormValues)[] | undefined;

    const isValid = await trigger(fieldsToValidate);
    if (!isValid) {
      console.log("Validation failed", form.formState.errors);
      return;
    }

    if (currentStep < activeSteps.length - 1) {
      setDirection(1);
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    setDirection(-1);
    if (currentStep === 0) {
      onBack();
    } else {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFormSubmit = async (values: DetailedFormValues) => {
    setIsLoading(true);
    try {
      const result = await createBudgetAction('renovation', values);
      if (result.success) {
        setSubmissionResult({ leadId: result.leadId, decision: result.decision });
        setIsSubmitted(true);
        toast({
          title: t.budgetRequest.form.toast.success.title,
          description: t.budgetRequest.form.toast.success.description,
        });
      } else {
        throw new Error(result.error || 'Error desconocido');
      }
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: t.budgetRequest.form.toast.error.title,
        description: t.budgetRequest.form.toast.error.description,
      });
    } finally {
      setIsLoading(false);
    }
  }

  const handleFinalSubmit = handleSubmit(handleFormSubmit);

  const handleRestart = () => {
    reset();
    setCurrentStep(0);
    setIsSubmitted(false);
    setSubmissionResult(null);
  }

  const stepVariants = {
    hidden: (direction: number) => ({
      opacity: 0,
      x: direction > 0 ? '100%' : '-100%',
    }),
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: 'spring',
        stiffness: 260,
        damping: 30,
      },
    },
    exit: (direction: number) => ({
      opacity: 0,
      x: direction < 0 ? '100%' : '-100%',
      transition: {
        type: 'spring',
        stiffness: 260,
        damping: 30,
      },
    }),
  };

  const renderDetailedStep = () => {
    const stepId = activeSteps[currentStep]?.id;
    switch (stepId) {
      case 'contact': return <ContactStep form={form} t={t} />;
      case 'projectDefinition': return <ProjectDefinitionStep form={form} t={t} />;
      case 'demolition': return <DemolitionStep form={form} t={t} />;
      case 'bathroom': return <BathroomStep form={form} bathroomFields={bathroomFields} t={t} />;
      case 'kitchen': return <KitchenStep form={form} t={t} />;
      case 'workArea': return <WorkAreaStep form={form} t={t} />;
      case 'ceilings': return <CeilingsStep form={form} t={t} />;
      case 'electricity': return <ElectricityStep form={form} bedroomFields={bedroomFields} t={t} />;
      case 'carpentry': return <CarpentryStep form={form} t={t} />;
      case 'multimedia': return <MultimediaStep form={form} t={t} />;
      case 'summary': return <SummaryStep t={t} data={getValues()} />;
      default: return <div>Paso no encontrado</div>;
    }
  }

  if (isLoading) {
    return (
      <div className='w-full max-w-2xl mx-auto'>
        <Card>
          <CardContent className='pt-6'>
            <BudgetGenerationLoading />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isSubmitted) {
    const wasRejected = submissionResult?.decision === 'rejected';
    const headerTitle = wasRejected
      ? 'Gracias por contactarnos'
      : t.budgetRequest.confirmation.title;
    const headerDescription = wasRejected
      ? 'Hemos recibido tu solicitud, pero por el momento esta obra queda fuera del alcance de los proyectos que aborda Grupo RG.'
      : t.budgetRequest.confirmation.description;
    const bodyMessage = wasRejected
      ? 'Si crees que se trata de un error o quieres ampliar información, escríbenos directamente y un asesor revisará tu caso.'
      : 'He recopilado tus datos. Nuestro equipo revisará tu solicitud y te contactará en breve para preparar tu presupuesto.';

    return (
      <div className="text-center max-w-2xl mx-auto space-y-6">
        <Card className="animate-in zoom-in-50 duration-500">
          <CardHeader>
            <div className='mx-auto bg-green-100 p-4 rounded-full w-fit mb-4'>
              <MailCheck className='w-12 h-12 text-green-600' />
            </div>
            <CardTitle className="font-headline text-3xl">{headerTitle}</CardTitle>
            <CardDescription className="text-lg">{headerDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground text-lg">{bodyMessage}</p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
              <Button asChild>
                <a href='/'>{t.budgetRequest.confirmation.button}</a>
              </Button>
              <Button variant="outline" onClick={handleRestart}>
                <RotateCw className="mr-2 h-4 w-4" />
                {t.budgetRequest.confirmation.restartForm}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={isWidget ? 'w-full' : 'w-full max-w-5xl mx-auto'}>
      <div ref={progressContainerRef} className="scroll-mt-24">
        <Progress value={((currentStep + 1) / activeSteps.length) * 100} className={cn("w-full mb-8 mx-auto", isWidget ? "" : "max-w-5xl")} />
      </div>
      <Form {...form}>
        <form className="space-y-8">
          <Card className='text-left overflow-hidden'>
            <CardHeader>
              <CardTitle className='font-headline text-2xl text-center'>{t.budgetRequest.steps[activeSteps[currentStep]?.id]}</CardTitle>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={stepVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className='min-h-[450px]'
                >
                  {renderDetailedStep()}
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>

          <div className="flex justify-between items-center">
            <Button type="button" variant="outline" onClick={prevStep}>
              <ArrowLeft className="mr-2" /> {t.budgetRequest.form.buttons.prev}
            </Button>

            {currentStep === activeSteps.length - 1 ? (
              <Button type="button" onClick={handleFinalSubmit} disabled={isLoading} size="lg">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? t.budgetRequest.form.buttons.loading : t.budgetRequest.form.buttons.submit}
              </Button>
            ) : (
              <Button type="button" onClick={nextStep}>
                {t.budgetRequest.form.buttons.next} <ArrowRight className="ml-2" />
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
